/**
 * Container sizes - a freight job's Equipment Info, and the Size/Type of each
 * charge on its sheet (Jobs/EquipmentInfo, Jobs/ChargesComp/Charges).
 *
 * The charge sheet started every line at 40HC and offered only 40HC and 20HC,
 * whatever the job's equipment said - so a 20SD job's charges were all 40HC
 * until changed by hand, and 20SD could not be picked at all (on SNS, 7,230
 * charge lines are 20SD and three are 20HC). The user's report, 2026-10-09:
 * charges were not picking the size from the equipment.
 *
 * No React - unit tested.
 */
export const EQUIPMENT_SIZES = [
  '40HC', '20HC', '20SD', '20FR', '40SD', '45HC',
  '40HV', '45BK', '45OT', '45TK', '45VH', 'M3', '40OT', '20RE', '20TK',
  '40FR', '40BK', '40HCRF', '20BK', '20OT', '20FT',
];

/** What a line started at before, and still does on a job with no equipment. */
export const DEFAULT_CHARGE_SIZE = '40HC';

const sizesOf = (equipments) => [...new Set((equipments || [])
  .map((e) => String(e?.size ?? '').trim())
  .filter(Boolean))];

/** The size a new charge line starts with: the job's equipment's - the first
 *  listed, when it has more than one. */
export function startingSize(equipments) {
  return sizesOf(equipments)[0] || DEFAULT_CHARGE_SIZE;
}

/**
 * The sizes a charge line offers: the job's own first, then every other, and
 * the line's own when it is none of those (a migrated line can carry Climax's
 * spelling, '40 FR'). As { id, name } for the sheet's select.
 */
export function chargeSizeOptions(equipments, current) {
  const own = sizesOf(equipments);
  const extra = current && !EQUIPMENT_SIZES.includes(current) && !own.includes(current) ? [current] : [];
  return [...new Set([...own, ...EQUIPMENT_SIZES, ...extra])].map((s) => ({ id: s, name: s }));
}
