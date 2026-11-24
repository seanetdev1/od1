// The reporting tags - GAM, IFA, Other.
//
// ONE LIST, read by everything that offers them: Setup > Carriers, the flight
// screen's quick-register form, and the per-AWB override on the consignment
// grid. It used to be a separate copy in each, which is exactly how the ER ->
// GAM rename came to be three edits instead of one - and a fourth copy would
// have been a fourth chance to miss.
//
// The SERVER decides what is valid (functions/carrierCategory.js there, which
// also still knows 'ER' was the old spelling of GAM and translates it). This
// is only what the dropdowns offer.
export const CARRIER_CATEGORIES = ['GAM', 'IFA', 'Other'];

// Tag colours, shared for the same reason.
export const CATEGORY_COLOR = { GAM: 'blue', IFA: 'green', Other: 'default' };

// What each tag means, for the title on a dropdown - the names are initials
// and read as nothing at all to someone new.
export const CATEGORY_HINT = {
  GAM: 'Counts toward GAM Uplift on the monthly sector report',
  IFA: 'Counts toward IFA Loads on the monthly sector report',
  Other: 'Counts toward Other Carrier on the monthly sector report',
};
