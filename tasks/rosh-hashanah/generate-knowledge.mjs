import fs from 'node:fs';
import {catalog,packageOptions} from '../../shared/rosh-hashanah.mjs';
const facts = [
  'Separate festive Rosh Hashanah menu at /rosh-hashanah. It is ADDITIONAL to the existing weekday and Shabbat menus; their prices do not change.',
  ...Object.values(packageOptions).map(p=>`${p.name.he} (${p.name.en}): $${p.price}, ${p.adults} adults, ${p.children} children. Includes one fixed blessings plate, ${p.salads} full 12-salad sets, ${p.fish} fish units, ${p.mains} main courses, ${p.sides} sides, ${p.challah} challahs.`),
  'Only excess above each separate category allowance is charged: salad set $60, fish fillet/unit $30, fish-ball portion (2 units) $60, main $100, side $25, challah $10. Mixed fish choices use weighted units; do not charge included items or charge twice.',
  'One fish fillet = 1 unit; one portion of fish balls = 2 units. Homemade jam sets have no quantity limit and cost $0 extra; no flavor selection.',
  'Only the family package allows extra children, $49 each for a full child meal. Each child has one free side; every further side for THAT child costs $15. Children do not add challahs.',
  ...Object.entries(catalog).map(([category,items])=>`${category}: ${items.map(x=>x.name.he).join('; ')}`),
  'Blessings, salad sets and fixed child meal contents cannot be substituted. For ordering, direct customers to the dedicated festive builder. No special ordering cutoff or delivery date was supplied.',
].join('\n');
fs.writeFileSync(new URL('../../shared/rosh-hashanah-knowledge.json',import.meta.url),JSON.stringify(facts));
