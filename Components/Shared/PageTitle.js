import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { getInstallInfo, titleFor, FALLBACK_TITLE } from 'functions/installInfo';

// What the browser tab is called.
//
// There was no <title> anywhere in the app, so Chrome fell back to showing the
// URL - every install, and every tab within one, looking identical. With a
// test install open beside a live one that is not cosmetic: it is how someone
// ends up approving an invoice on the wrong system.
//
// The name is the INSTALL_ID, read from /health so there is ONE source of
// truth for it (the backend's env) rather than a copy in the frontend's build
// that can drift from it.
//
// It renders the fallback first and swaps when /health answers, which is a
// brief flicker on a cold load. That is the trade for not having to rebuild
// the frontend image per customer just to name a tab.
const PageTitle = () => {
  const [title, setTitle] = useState(FALLBACK_TITLE);

  useEffect(() => {
    let alive = true;
    getInstallInfo().then((info) => {
      if (alive) setTitle(titleFor(info));
    });
    return () => { alive = false; };
  }, []);

  return (
    <Head>
      <title>{title}</title>
    </Head>
  );
};

export default PageTitle;
