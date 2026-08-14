'use strict';

// Public order intake from the customer-facing site (customer-site/). Persists
// straight into the same versioned bm_state orders[] the admin app reads, so
// staff see the order without retyping anything from WhatsApp.

const crypto = require('node:crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');

const MAX_ATTEMPTS = 5;
const CANONICAL_ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

// Mirrors server/hotels/hotel-search-route.js: a checkout may only hand back a
// hotel that route could have produced.
const HOTEL_PROVIDER_ID_PATTERN = /^[NWR][1-9]\d{0,18}$/u;
const HOTEL_MINIMUM_LATITUDE = 22.5;
const HOTEL_MAXIMUM_LATITUDE = 26.5;
const HOTEL_MINIMUM_LONGITUDE = 51;
const HOTEL_MAXIMUM_LONGITUDE = 56.6;
const HOTEL_FIELDS = ['hotelName', 'hotelAddress', 'hotelLatitude', 'hotelLongitude', 'hotelProviderId'];

function coordinateNavigationUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

const LineSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500),
  unitPrice: z.number().finite().nonnegative().max(100_000),
  qty: z.number().int().positive().max(999),
  note: z.string().trim().max(2_000).optional(),
});

const OrderSubmissionSchema = z.object({
  customer: z
    .object({
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().min(1).max(60),
      email: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
      address: z.string().trim().max(1_000).optional().default(''),
      notes: z.string().trim().max(2_000).optional(),
      fulfillment: z.enum(['delivery', 'pickup']).optional().default('delivery'),
      date: z.union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/u), z.literal('')]).optional().default(''),
      time: z.union([z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/u), z.literal('')]).optional().default(''),
      hotelName: z.string().trim().min(1).max(200).optional(),
      hotelAddress: z.string().trim().min(1).max(500).optional(),
      hotelLatitude: z.number().finite().min(HOTEL_MINIMUM_LATITUDE).max(HOTEL_MAXIMUM_LATITUDE).optional(),
      hotelLongitude: z.number().finite().min(HOTEL_MINIMUM_LONGITUDE).max(HOTEL_MAXIMUM_LONGITUDE).optional(),
      hotelProviderId: z.string().trim().max(32).regex(HOTEL_PROVIDER_ID_PATTERN).optional(),
    })
    // A hotel is one identity, never a half-filled one: the admin order editor
    // stores coordinates only alongside a provider ID, and so must a site order.
    .refine((customer) => {
      const present = HOTEL_FIELDS.filter((field) => customer[field] !== undefined);
      return present.length === 0 || present.length === HOTEL_FIELDS.length;
    }, { message: 'a hotel selection needs every hotel field', path: ['hotelName'] })
    .refine((customer) => customer.fulfillment === 'delivery' || customer.hotelName === undefined, {
      message: 'a hotel cannot be attached to a pickup order',
      path: ['hotelName'],
    })
    .refine(
      (customer) =>
        customer.fulfillment === 'pickup' || customer.address.length > 0 || customer.hotelName !== undefined,
      { message: 'address or hotel is required for delivery orders', path: ['address'] },
    ),
  lines: z.array(LineSchema).min(1).max(100),
  total: z.number().finite().nonnegative().max(1_000_000),
});

function dubaiDateString(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(now);
}

function orderId(now) {
  return `site-${now.getTime()}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildLegacyOrder(submission, now) {
  const itemsText = submission.lines
    .map((line) => {
      const noteText = line.note ? ` (${line.note})` : '';
      return `${line.name} x${line.qty}${noteText} — $${(line.unitPrice * line.qty).toFixed(2)}`;
    })
    .join('\n');
  const isPickup = submission.customer.fulfillment === 'pickup';
  const notes = [itemsText, isPickup ? 'איסוף עצמי' : undefined, submission.customer.notes].filter(Boolean).join('\n\n');
  const id = orderId(now);
  if (!CANONICAL_ORDER_ID_PATTERN.test(id)) {
    throw new Error('generated order id is not canonical');
  }
  const hotelName = isPickup ? undefined : submission.customer.hotelName;
  // The customer's own address line is the room/notes detail once a hotel is
  // picked, so every screen that only reads `address` still shows where to go.
  const deliveryAddress = hotelName
    ? [hotelName, submission.customer.address].filter(Boolean).join(' — ')
    : submission.customer.address;
  return {
    id,
    date: submission.customer.date || dubaiDateString(now),
    time: submission.customer.time,
    name: submission.customer.name,
    phone: submission.customer.phone,
    email: submission.customer.email || undefined,
    address: isPickup ? 'איסוף עצמי' : deliveryAddress,
    // Same field names the admin order editor writes (serializeOrderDraft), so
    // delivery routing reads a site hotel exactly like a staff-entered one.
    ...(hotelName
      ? {
          place: hotelName,
          hotelName,
          hotelAddress: submission.customer.hotelAddress,
          hotelProviderId: submission.customer.hotelProviderId,
          hotelLatitude: submission.customer.hotelLatitude,
          hotelLongitude: submission.customer.hotelLongitude,
          navigationUrl: coordinateNavigationUrl(
            submission.customer.hotelLatitude,
            submission.customer.hotelLongitude,
          ),
        }
      : {}),
    status: 'חדשה',
    source: 'site',
    notes,
    total: submission.total,
    payMethod: '',
    paid: 'לא',
  };
}

function createSiteOrderRouter({ repository, logger = console }) {
  if (!repository || typeof repository.loadState !== 'function' || typeof repository.saveState !== 'function') {
    throw new TypeError('A state repository is required');
  }
  if (!logger || typeof logger.error !== 'function') {
    throw new TypeError('A logger with an error method is required');
  }

  const router = express.Router();

  router.use(express.json({ limit: '256kb' }));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1_000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    })
  );
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/', async (request, response) => {
    const parsed = OrderSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'invalid order' });
    }

    const now = new Date();
    let legacyOrder;
    try {
      legacyOrder = buildLegacyOrder(parsed.data, now);
    } catch (error) {
      logger.error('site order build failed', error);
      return response.status(500).json({ error: 'order could not be created' });
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const current = await repository.loadState();
        const localState = { ...current.data, orders: [...current.data.orders, legacyOrder] };
        const saved = await repository.saveState({
          baseState: current.data,
          localState,
          baseRevision: current.revision,
          baseHash: current.hash,
          requestId: crypto.randomUUID(),
        });
        if (saved.ok) {
          return response.status(201).json({ ok: true, orderId: legacyOrder.id });
        }
      } catch (error) {
        logger.error('site order save attempt failed', error);
      }
    }

    return response.status(503).json({ error: 'order could not be saved, please try again' });
  });

  return router;
}

module.exports = { createSiteOrderRouter };
