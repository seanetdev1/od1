import React from 'react';
import { companyDetails, companyLogo } from 'functions/companyBranding';

// The letterhead block used at the top of vouchers, delivery orders, BLs and
// other prints.
//
// This replaces per-file hardcoded blocks that looked like:
//
//   <img src={'/seanet-logo.png'} height={100} />
//   <div>{compLogo == "1" ? "SEA NET SHIPPING & LOGISTICS" : "AIR CARGO SERVICES"}</div>
//   <div>House# A230, PECHS, Block 2,  Karachi</div>
//   <div>Tel: 9221 34395444-55-66   Fax: 9221 34385001</div>
//   <div>Email: {compLogo == "1" ? "info@seanetpk.com" : "info@acs.com.pk"}</div>
//   <div>NTN # {compLogo == "1" ? "8271203-5" : "0287230-7"}</div>
//
// Every one of those values is a column on Company (title, logo/printLogo,
// address, phone, email, web, ntn, strn), editable per install in
// Config > Companies. Hardcoding them meant a leased install printed our
// letterhead on its customers' documents.
//
// Fields that are blank on the Company record simply don't render - no
// placeholder, and never a fallback to another company's details.
// Several layouts split the letterhead across two columns - logo on the left,
// name and contact details in the middle - so showLogo / showTitle / showContact
// let one component serve both halves without a second implementation.
const CompanyLetterhead = ({
  companyId,
  logoHeight = 100,
  logoStyle,
  titleSize = 20,
  paraStyles = {},
  showLogo = true,
  showTitle = true,
  showContact = true,
  align = 'center',
}) => {
  const logo = companyLogo(companyId, { print: true });
  const { title, address, phone, email, web, ntn, strn } = companyDetails(companyId);

  return (
    <div className={align === 'center' ? 'text-center' : ''}>
      {showLogo && logo && (
        // In its own colours. This carried `filter: invert(0.5)` by default,
        // which turns EVERY pixel the same mid-grey - a coloured logo printed
        // (and saved to PDF) as a flat grey shape, so the whole document read
        // as black and white.
        <img
          src={logo}
          alt=""
          height={logoHeight}
          style={logoStyle}
        />
      )}
      {showTitle && title && <div style={{ fontSize: titleSize }}><b>{title}</b></div>}
      {showContact && (
        <>
          {address && <div style={paraStyles}>{address}</div>}
          {phone && <div style={paraStyles}>Tel: {phone}</div>}
          {(email || web) && (
            <div style={paraStyles}>
              {email && <>Email: {email}</>}
              {email && web && <>{'   '}</>}
              {web && <>Web: {web}</>}
            </div>
          )}
          {ntn && <div style={paraStyles}>NTN # {ntn}</div>}
          {strn && <div style={paraStyles}>STRN # {strn}</div>}
        </>
      )}
    </div>
  );
};

export default CompanyLetterhead;
