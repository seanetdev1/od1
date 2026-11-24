import React from 'react';
import { HomeOutlined } from '@ant-design/icons';
import {
  RiShipLine, RiPlaneLine, RiFlightTakeoffLine, RiFileShield2Line, RiSettings3Line,
  RiWallet3Line, RiBarChartBoxLine, RiTaskLine, RiEqualizerLine,
} from 'react-icons/ri';

/* EACH SIDEBAR SECTION'S ICON, by the section's key - the first part of every
   tab key that belongs to it ('4-3' an SE job, '4-4' its B/L: Sea Jobs).
   One map, read by the sidebar (functions/setAccesLevels), every tab in the
   tab strip and the header's page name (Components/Shared/MainLayout) - so a
   B/L, a job or an invoice opened from somewhere other than the menu carries
   its section's icon too (the user, 2026-11-23). '0' is the pinned Dashboard
   tab. */
const SECTION_ICON_TYPES = {
  0: HomeOutlined,
  1: HomeOutlined,
  2: RiSettings3Line,
  3: RiWallet3Line,
  4: RiShipLine,
  5: RiBarChartBoxLine,
  6: RiTaskLine,
  7: RiPlaneLine,
  8: HomeOutlined,
  9: RiEqualizerLine,
  10: RiFlightTakeoffLine,
  11: RiFileShield2Line,
};

/** The section key a tab key belongs to: '4-3' -> '4'. */
export const sectionOf = (tabKey) => String(tabKey ?? '').split('-')[0];

/** The icon of the section `key` (a section key or any tab key), or null. */
export function sectionIcon(key, props) {
  const Icon = SECTION_ICON_TYPES[sectionOf(key)];
  return Icon ? <Icon {...props} /> : null;
}
