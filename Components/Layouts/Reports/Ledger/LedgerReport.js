import React, { useEffect, useState } from "react";
import moment from "moment";
import MainTable from "./MainTable";
import { Spinner } from "react-bootstrap";
import { inLedgerOrder } from "functions/ledgerOrder";

const LedgerReport = ({ voucherData, from, to, name, company, currency, accountId, letterhead = null, printedBy = '', printOnly = false }) => {
  const [ledger, setLedger] = useState([]);
  const [opening, setOpening] = useState(0.0);
  const [closing, setClosing] = useState(0.0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setOpening(0.0);
    setClosing(0.0);
    setLedger([]);

    const result = Array.isArray(voucherData?.result) ? voucherData.result : [];

    if (!name || voucherData?.status !== "success" || result.length === 0) {
      setLoading(false);
      return;
    }

    const isPKR = currency === "PKR";

    // For foreign-currency ledgers, exclude system accounts
    const rows = isPKR
      ? result
      : result.filter(
          (x) =>
            x.accountType !== "Gain/Loss Account" && x.accountType !== "General"
        );

    const fromDate = moment(from, "DD-MM-YYYY");
    const toDate = moment(to, "DD-MM-YYYY");

    const getAmount = (y) => {
      const raw = isPKR ? y.defaultAmount : y.amount;
      const parsed = parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const signedAmount = (y) =>
      y.type === "debit" ? getAmount(y) : -getAmount(y);
    const isExRateEntry = (y) => !isPKR && y.narration?.includes("Ex-Rate");

    // Pass 1: split rows into opening (before `from`) and in-range (from..to inclusive)
    let openingBalance = 0;
    const inRange = [];

    rows.forEach((y) => {
      const createdAt = moment(y.createdAt);
      if (createdAt.isBetween(fromDate, toDate, "day", "[]")) {
        inRange.push(y);
      } else if (createdAt.isBefore(fromDate, "day")) {
        // An OP voucher before the period is part of this, like any other
        // entry - it is not shown as a row of its own. See functions/ledgerRows.
        openingBalance += signedAmount(y);
      }
      // Entries after `to` are ignored entirely — they belong to neither
      // the opening balance nor the report period.
    });

    // Pass 2: build ledger rows with a running balance seeded from the opening -
    // in ledger order: the day, then the order the entries were made
    // (functions/ledgerOrder).
    let runningBalance = openingBalance;
    const ledgerRows = [];

    inLedgerOrder(inRange).forEach((y) => {
      if (isExRateEntry(y)) return;

      runningBalance += signedAmount(y);

      const chequeTemp =
        y["Voucher.chequeNo"] +
        " | " +
        moment(y["Voucher.chequeDate"]).format("DD-MM-YYYY");

      ledgerRows.push({
        date: y.createdAt,
        voucherType: y["Voucher.type"],
        vouchervType: y["Voucher.vType"],
        voucherId: y["Voucher.id"],
        amount: getAmount(y),
        checkDets:
          chequeTemp.includes("null") || chequeTemp.includes("Invalid")
            ? ""
            : chequeTemp,
        balance: runningBalance,
        voucher: y["Voucher.voucher_Id"],
        type: y.type,
        narration: y.narration,
      });
    });

    setOpening(openingBalance);
    // The opening balance when nothing moved in the period - it was 0, so an
    // account carrying a balance in and out showed "Closing: 0.00".
    setClosing(runningBalance);
    setLedger(ledgerRows);
    setLoading(false);
  }, [voucherData, from, to, name, company, currency]);

  return (
    <div className="base-page-layout">
      {/* A LEDGER WITH NO ENTRIES STILL RENDERS WHEN IT IS BEING PRINTED.
          On screen, showing nothing for an empty range is fine - the user can
          see the range they picked. For the PDF it is not: Puppeteer waits for
          `.ledger-print-root` to appear, and a gate that never renders it turns
          "this account had no movement" into a ten-second hang and a 500. An
          empty ledger is a legitimate document that says so. */}
      {/* AN OPENING BALANCE IS A LEDGER TOO. Gated on entries in the range
          alone, an account with money brought forward and no movement in the
          period showed a blank page - its balance hidden, and the page
          looking broken. */}
      {!loading && (ledger.length > 0 || opening !== 0 || printOnly) && (
        <MainTable
          ledger={ledger}
          closing={closing}
          opening={opening}
          name={name}
          company={company}
          currency={currency}
          from={from}
          to={to}
          accountId={accountId}
          letterhead={letterhead}
          printedBy={printedBy}
          printOnly={printOnly}
        />
      )}
      {/* NOTHING AT ALL - SAID, not a blank page. A blank page reads as "the
          ledger will not open": that is how two CargoLinkers accounts were
          reported, and both were duplicates in the chart with no entries -
          the parties' history is under another account of the same name. */}
      {!loading && !printOnly && ledger.length === 0 && opening === 0 && (
        <div style={{ textAlign: "center", marginTop: 50, color: "#666" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{name || "This account"} has no entries up to {to}.</div>
          <div style={{ marginTop: 6 }}>
            Nothing has been posted to it{currency && currency !== "PKR" ? ` in ${currency}` : ""} for this company.
            If the party has another account in the Chart of Accounts, its history may be there.
          </div>
        </div>
      )}
      {loading && (
        <div style={{ textAlign: "center", marginTop: 50 }}>
          <Spinner animation="border" role="status" />
        </div>
      )}
    </div>
  );
};

export default React.memo(LedgerReport);
