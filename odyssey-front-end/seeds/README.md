# seeds/ (frontend)

One-time migration data for the Climax cutover. **Not tracked in git** — see
`.gitignore` (`seeds/*.seed.json`).

## Why

`Components/Layouts/Main/InvoicedUploader.js` was 50,627 lines. The React
component is about 300 of them. The other ~50,300 were four array literals —
`paybleOne`, `paybleTwo`, `paybleThree`, `paybleFour`, 662 records each — of
real payable invoices: party names, invoice numbers, amounts, dated 2011–2024.
Only `paybleFour` was ever referenced; the other three were dead.

Two problems, one of them latent:

1. **Real financial records in a source repo.** They get cloned, built, and
   committed to history permanently. This is the live problem.
2. **One import away from the client bundle.** As module-level constants in a
   React component, webpack would inline all 2,648 records into the JavaScript
   served to browsers as soon as this screen is wired up. It is *not* wired up
   today — the `<InvoicedUploader />` tag is commented out in `Uploader.js`,
   and `Uploader.js` is itself imported by nothing, so the whole tree is
   currently orphaned and does not reach any bundle. Uncommenting one line
   would have changed that.

That is the actual problem with this file — not its line count.

## Files

| File | Used by | Shape |
|---|---|---|
| `openingInvoices.seed.json` | `InvoicedUploader.js` → `POST /invoice/uploadbulkInvoicesTest` | `{ paybleOne, paybleTwo, paybleThree, paybleFour }`, 662 records each |

Record fields: `companyId`, `party_Name`, `jobNo`, `currency`, `operation`,
`ex_rate`, `type`, `payType`, `status`, `invoice_No`, `paid`, `roundOff`,
`approved`, `total`, `createdAt`, `payable`, `balance`.

## Running it

Drop the file here and re-enable the component — it is currently commented out
in `Components/Layouts/Main/Uploader.js`. The loader is a dynamic `import()`,
so with no file present the build still succeeds and the upload button logs a
clear error instead of half-running.

## If you no longer need this

Delete the seed file, the component, and its entry in `Uploader.js`. This is
cutover scaffolding, not a feature.

## Note on history

Deleting the data from the working tree does not remove it from commits that
already contain it. If this repository's history is ever published or handed
over, those records are still in it and the history needs rewriting.
