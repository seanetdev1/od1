/**
 * Thousands separators for an amount box - in the whole part only.
 *
 * The boxes used `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','), which
 * groups the digits after the point too: -0.4799999999 showed as
 * "-0.47,999,999,9" (the user's report, 2026-10-26). Read back with
 * ungroupThousands, which drops the commas.
 */
export const groupThousands = (value) => {
  const [whole, fraction] = String(value ?? '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
};

export const ungroupThousands = (value) => value?.replace(/,/g, '');
