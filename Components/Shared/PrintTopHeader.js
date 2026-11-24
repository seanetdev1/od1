import React from 'react';
import { allCompanies, companyDetails, companyLogo, reportLetterheadId } from 'functions/companyBranding';

// Header shown on printed reports. Everything here comes from the Company
// record now - it used to hardcode Seanet/ACS names, logo filenames and even
// the street address, which meant any other client's reports printed our
// letterhead. See functions/companyBranding.js.
const PrintTopHeader = ({company, from, to, letterhead: record = null}) => {
  // "All companies" prints the letterhead of the company selected in the
  // header - see reportLetterheadId. It printed a blank one: 'all' is not a
  // company, so the name, logo and address all came back empty.
  const letterhead = reportLetterheadId(company);
  // `record` is the Company itself, for a page with no session and so no
  // company list to look it up in - the ledger PDF's (pages/ledger-print).
  const logo = record ? (record.printLogo || record.logo || null) : companyLogo(letterhead, { print: true });
  const { title, address } = record
    ? { title: record.title || record.short || '', address: record.address || '' }
    : companyDetails(letterhead);

  // Every name only when there is no company to print at all - a session that
  // has not chosen one in the header yet.
  const heading = title || allCompanies().map((c) => c.title || c.short).filter(Boolean).join(' + ');

  return (
    <>
    <div className="d-flex justify-content-between" >
        <div style={{width:"20%"}} className="text-center">
            {/* Deliberately renders nothing when the company has no logo -
                never a bundled fallback image, which would be another
                tenant's artwork. */}
            {/* In its own colours: the `invert` class this had greyed it out. */}
            {logo && <img src={logo} width={130} alt=""/>}
        </div>
        <div style={{width:"60%"}} className="text-center">
            <h5>
                <b>{heading}</b>
            </h5>
            {address && <div className="fs-13">{address}</div>}
            <b>
                <span>{from?'Dated: '+from:''}</span> <span className='mx-2'>-</span> <span>{to?to:''}</span>
            </b>
        </div>
        <div style={{width:"20%", paddingTop:20}}>
        </div>
    </div>
    </>
  )
}

export default PrintTopHeader
