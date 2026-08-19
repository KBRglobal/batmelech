import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { useLocation } from 'react-router'
import { canonicalPath, useLocale, type Locale } from '../locale-context'

// Pages whose own fixed bottom bar (order summary / checkout submit) owns the
// bottom of a phone screen — the floating chat toggle hides there on mobile so
// it never covers the primary CTA. Desktop has room for both.
const BOTTOM_BAR_PATHS = new Set(['/shabbat-order', '/shabbat-extras', '/checkout'])

/**
 * Floating concierge chat: answers visitor questions in any language from the
 * server-side knowledge block (POST /api/site/concierge/). The chat never
 * places orders — on any failure it hands the visitor off to WhatsApp.
 */

const WHATSAPP_URL = 'https://wa.me/971586288776'
const MAX_HISTORY = 12
const MAX_MESSAGE_LENGTH = 1000

type ChatMessage = { role: 'user' | 'assistant'; content: string }

const HE = {
  open: 'צ׳אט עם המטבח',
  close: 'סגירת הצ׳אט',
  title: 'בת מלך',
  subtitle: 'כאן לכל שאלה',
  greeting: 'שלום! שאלו אותנו הכל — תפריט, מחירים, משלוחים, כשרות.',
  placeholder: 'כתבו שאלה...',
  send: 'שליחה',
  typing: 'בת מלך כותבת...',
  error: 'משהו השתבש אצלנו. אפשר לכתוב לנו ישירות בוואטסאפ ונענה מהר:',
  whatsapp: 'לוואטסאפ',
}

const COPY: Record<Locale, typeof HE> = {
  he: HE,
  en: {
    open: 'Chat with the kitchen',
    close: 'Close chat',
    title: 'Bat Melech',
    subtitle: 'Here for any question',
    greeting: 'Shalom! Ask us anything — menu, prices, delivery, kashrut.',
    placeholder: 'Type a question...',
    send: 'Send',
    typing: 'Bat Melech is typing...',
    error: 'Something went wrong on our side. Message us directly on WhatsApp and we will answer quickly:',
    whatsapp: 'Open WhatsApp',
  },
  fr: {
    open: 'Discuter avec la cuisine',
    close: 'Fermer la discussion',
    title: 'Bat Melech',
    subtitle: 'À votre écoute',
    greeting: 'Chalom ! Posez-nous toutes vos questions — menu, prix, livraison, cacherout.',
    placeholder: 'Écrivez une question...',
    send: 'Envoyer',
    typing: 'Bat Melech écrit...',
    error: 'Un souci de notre côté. Écrivez-nous directement sur WhatsApp, nous répondons vite :',
    whatsapp: 'Ouvrir WhatsApp',
  },
}

async function fetchReply(messages: ChatMessage[]): Promise<string | null> {
  try {
    const response = await fetch('/api/site/concierge/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    })
    if (!response.ok) return null
    const data: unknown = await response.json()
    const reply = (data as { reply?: unknown } | null)?.reply
    return typeof reply === 'string' && reply.trim() !== '' ? reply.trim() : null
  } catch {
    return null
  }
}

export function ConciergeChat() {
  const { locale, dir } = useLocale()
  const { pathname } = useLocation()
  const hasBottomBar = BOTTOM_BAR_PATHS.has(canonicalPath(pathname).path)
  const t = COPY[locale]
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, sending, failed, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = async () => {
    const content = input.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (content === '' || sending) return
    const history = [...messages, { role: 'user' as const, content }].slice(-MAX_HISTORY)
    setMessages(history)
    setInput('')
    setFailed(false)
    setSending(true)
    const reply = await fetchReply(history)
    setSending(false)
    if (reply === null) {
      setFailed(true)
      return
    }
    setMessages((current) => [...current, { role: 'assistant' as const, content: reply }].slice(-MAX_HISTORY))
  }

  return (
    <div dir={dir} className="fixed bottom-6 right-6 md:bottom-10 md:right-10 z-[210] flex flex-col items-end gap-3">
      {open && (
        <div className="fixed inset-x-0 bottom-0 w-full h-[85dvh] rounded-t-3xl md:relative md:inset-auto md:bottom-auto md:w-[24rem] md:max-w-[calc(100vw-5rem)] md:h-[28rem] md:max-h-[70vh] md:rounded-3xl bg-[#F7ECE6] shadow-2xl border border-[#3B151A]/10 flex flex-col overflow-hidden">
          <div className="bg-[#3B151A] text-white px-5 py-4 flex items-center gap-3 shrink-0">
            <span className="w-9 h-9 rounded-full bg-[#F5A83A] text-[#3B151A] flex items-center justify-center shrink-0">
              <Icon icon="ph:chat-circle-dots-fill" className="text-xl" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-black text-sm leading-tight">{t.title}</p>
              <p className="text-white/70 text-xs leading-tight">{t.subtitle}</p>
            </div>
            <button
              type="button"
              aria-label={t.close}
              onClick={() => setOpen(false)}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0 transition-colors"
            >
              <Icon icon="ph:x-bold" className="text-lg" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
            <Bubble role="assistant">{t.greeting}</Bubble>
            {messages.map((message, index) =>
              message.role === 'assistant' ? (
                <AssistantBubble key={index} content={message.content} whatsappLabel={t.whatsapp} />
              ) : (
                <Bubble key={index} role="user">{message.content}</Bubble>
              )
            )}
            {sending && (
              <Bubble role="assistant">
                <span className="inline-flex items-center gap-2 text-[#3B151A]/60">
                  <Icon icon="ph:dots-three-bold" className="text-lg animate-pulse" />
                  {t.typing}
                </span>
              </Bubble>
            )}
            {failed && (
              <Bubble role="assistant">
                <span className="block">{t.error}</span>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#F5A83A] text-[#3B151A] px-3 py-1.5 text-xs font-black shadow"
                >
                  <Icon icon="ph:whatsapp-logo-fill" className="text-base" />
                  {t.whatsapp}
                </a>
              </Bubble>
            )}
          </div>

          <form
            className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white/60 border-t border-[#3B151A]/10 flex items-center gap-2 shrink-0"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <input
              ref={inputRef}
              type="text"
              dir="auto"
              value={input}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder={t.placeholder}
              onChange={(event) => setInput(event.target.value)}
              className="flex-1 min-w-0 rounded-full bg-white text-[#3B151A] placeholder-[#3B151A]/40 text-base md:text-sm px-4 py-2.5 outline-none border border-[#3B151A]/10 focus:border-[#F5A83A]"
            />
            <button
              type="submit"
              aria-label={t.send}
              disabled={sending || input.trim() === ''}
              className="w-10 h-10 rounded-full bg-[#F5A83A] text-[#3B151A] flex items-center justify-center shadow-md disabled:opacity-40 transition-opacity shrink-0"
            >
              <Icon icon="ph:paper-plane-right-fill" className="text-lg rtl:-scale-x-100" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        aria-label={open ? t.close : t.open}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`${open || hasBottomBar ? 'hidden md:flex' : 'flex'} w-16 h-16 md:w-20 md:h-20 rounded-full bg-[#3B151A] hover:bg-black text-white shadow-2xl items-center justify-center transition-all group`}
      >
        <Icon
          icon={open ? 'ph:x-bold' : 'ph:chat-circle-dots-fill'}
          className="text-2xl md:text-3xl group-hover:scale-110 transition-transform"
        />
        {!open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#F5A83A] border-2 border-[#F7ECE6] shadow" />
        )}
      </button>
    </div>
  )
}

// The model is told to say "ask on WhatsApp" without spelling out a number.
// If a raw number or wa.me link still slips into the text, strip it here —
// the visitor always gets a clean sentence plus one styled, clickable button.
export const WHATSAPP_MENTION = /wa\.me|whatsapp|whats\s*app|וואטסאפ|ווטסאפ/iu

export function stripWhatsAppContact(content: string): string {
  return content
    .replace(/https?:\/\/wa\.me\/\S+/giu, '')
    .replace(/(?:\+?\(?971\)?[\s-]*)?0?58[\s-]*628[\s-]*8776/gu, '')
    .replace(/\s+([.,:;!?])/gu, '$1')
    .replace(/[:;][\s]*([.,!?])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[:\s]+$/gu, '')
    .trim()
}

function AssistantBubble({ content, whatsappLabel }: { readonly content: string; readonly whatsappLabel: string }) {
  const mentionsWhatsApp = WHATSAPP_MENTION.test(content)
  const text = mentionsWhatsApp ? stripWhatsAppContact(content) : content
  return (
    <Bubble role="assistant">
      {text !== '' && <span className="block">{text}</span>}
      {mentionsWhatsApp && (
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#F5A83A] text-[#3B151A] px-3 py-1.5 text-xs font-black shadow"
        >
          <Icon icon="ph:whatsapp-logo-fill" className="text-base" />
          {whatsappLabel}
        </a>
      )}
    </Bubble>
  )
}

function Bubble({ role, children }: { readonly role: 'user' | 'assistant'; readonly children: ReactNode }) {
  const isUser = role === 'user'
  return (
    <div
      dir="auto"
      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm ${
        isUser ? 'self-end bg-[#3B151A] text-white' : 'self-start bg-white text-[#3B151A]'
      }`}
    >
      {children}
    </div>
  )
}
