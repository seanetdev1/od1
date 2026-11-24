# Deploying a fresh Odyssey install

For a company with **no legacy system to migrate from**. If the install is
replacing a Climax system, follow steps 1–3 here and then use
**Config → Migration** instead of steps 4 onwards — the migration creates the
companies, chart of accounts and everything else from the legacy data.

Nothing here is company-specific. Every value that used to be hardcoded to
Seanet/ACS/CLS now comes from the database, so the only thing that makes this
install belong to a particular company is what you enter in step 4.

---

## 1. Database

Create an empty database. Name it after the install — several installs on one
server must not share a name.

```powershell
psql -U postgres -c 'CREATE DATABASE "odyssey-ifa";'
```

If you intend to run the test suite on this machine, create a second, throwaway
one. The suite truncates Sessions and deletes rows; pointing it at the working
database signs out every logged-in user. Its name must contain `test`.

```powershell
psql -U postgres -c 'CREATE DATABASE "odyssey-ifa-test";'
```

## 2. Backend configuration

Copy `.env.example` to `.env` and fill it in. Every value is per-install — do
not copy a filled-in `.env` from another customer.

```ini
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASS=<the database password>
DB_NAME=odyssey-ifa
DB_NAME_TEST=odyssey-ifa-test

ODYSSEY_DB_SYNC=create

# Generate a UNIQUE value. Reusing one across installs would let a token issued
# by one server validate on another.
JWT_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">

INSTALL_ID=<the id you registered on the licence server>
LICENSE_SERVER_URL=https://license.seanetpk.com
LICENSE_EXEMPT=false

# Leave BLANK. A strong password is generated and printed once, on the boot
# that creates the account.
ADMIN_SEED_USERNAME=admin
ADMIN_SEED_PASSWORD=

FRONTEND_BASE_URL=http://localhost:3003
```

`LICENSE_EXEMPT` stays `false` for a group company. It is only for the install
owned by the company that built the software.

## 3. First boot

```powershell
npm install
npm run start:prod     # NODE_ENV=production, 7 workers, port 8088
```

`npm run start` is the same thing without `NODE_ENV`, which resolves to the
`development` database block. Both read `DB_NAME`/`DB_USER`/`DB_PASS` when
`DATABASE_URL` is not set, so either works — use `start:prod` on a client
install so the environment matches what it is. `npm run dev` is a single
process with nodemon, for development only.

Watch the log for two things:

```
Database & tables created (missing tables only; no ALTER).
[seed] created initial admin user 'admin'
[seed]  Initial admin password: ....
```

**The password is printed once and is not recoverable** — it is stored as a
bcrypt hash. Copy it now.

If you see a `SCHEMA SYNC FAILED` banner, stop and read it; the server will
still start but the schema is incomplete.

### Chart of accounts

The application looks several account titles up by exact string, so this is not
optional and the names are not adjustable:

```powershell
node scripts/seedChartOfAccounts.js            # report what it would create
node scripts/seedChartOfAccounts.js --apply
```

Three of the required titles are misspelled in the application itself
(`LAIBILITY`, `CONTRA ACCOUNT OPENINIG`, and `LCL FREIGHT EXP` rather than
EXPENSE). The seed matches them deliberately. Correcting a spelling would not
fail loudly — the balance sheet would simply come back empty, or a job invoice
would post with no income account.

### Reference data (optional)

Ports, destinations and airports, if you want the pick lists pre-filled:

```powershell
node scripts/seedPickLists.js
```

## 4. Configure the company

Log in as `admin` with the password from the boot log, **change it**, then go to
**Config**:

1. **Company** — create it. `short` is the important field: it becomes the
   prefix on every document number, so a code of `IFA` produces

   ```
   Job       IFA-SEJ-1/26
   Invoice   IFA-JI-1/26
   Voucher   IFA-BPV-1/26
   DO        IFA-DO1-26
   ```

   Also set the title, address and logo — these appear on printed invoices and
   letterheads, and are read from the database, not from a bundled asset.

2. **Bank accounts** — add them under the company. They appear on invoices.
   There is no default set; they used to be hardcoded and are not any more.

3. **Fiscal year** — create one and select it. **Nothing can be created until a
   fiscal year exists**: jobs, invoices and vouchers are all tagged with one and
   the create fails with *"Select a fiscal year to work in before creating this
   record"* if there is none.

4. **Employees** — create real users. The seeded `admin` is a bootstrap account.

Do **not** open Config → Migration on a fresh install. It has no legacy server
to talk to.

## 5. Frontend

```powershell
cd ../Odyssey-Front-end
npm install
npm run build
npm run start
```

`.env` needs `NEXT_PUBLIC_CLIMAX_MAIN_URL` pointing at the backend. Leave
`NEXT_PUBLIC_CLIMAX_LEGACY_URL` unset — there is no legacy server.

## 6. Verify before handing over

Run through this in the UI. Each step exercises something the previous one set
up, so a failure tells you which piece is missing.

| # | Action | Confirms |
|---|--------|----------|
| 1 | Log in, change the admin password | auth, sessions |
| 2 | Create a client with a ledger account | chart of accounts is seeded |
| 3 | Create a job | fiscal year, company code in `jobNo` |
| 4 | Add charges to the job | charge master, client accounts |
| 5 | Generate an invoice from it | freight income/expense accounts exist |
| 6 | Print the invoice | company title, logo, bank accounts |
| 7 | Record a payment against it | vouchers, `paid`/`recieved`, transactions |
| 8 | Open the trial balance | voucher heads post to the right accounts |

Check the numbers on steps 3 and 5: the prefix must be the company's own short
code. If you see `SNS`, `CLS` or `ACS`, something is reading a hardcoded value
and it should be reported rather than worked around.

---

## Known limitations on a fresh install

These are safe but worth knowing:

- **The legacy uploader screens are dead.** `Uploader.js`,
  `PartiesUploader.js` and `InvoicedUploader.js` are not imported by any page,
  and the routes they called reference models deleted in `03f9975`
  (`Parent_Account`, `Accounts`, `Vendors`). They throw if reached. Nothing in
  the application links to them. `tests/unit/modelReferences.test.js` pins the
  list so a new one cannot appear unnoticed.

- **Vendor routes are non-functional** for the same reason. Vendors are handled
  as parties through the client tables.

- **The chart of accounts is global**, not per company. `Child_Account` has no
  `CompanyId`; separation between companies comes from the voucher, which does.
  One seeded chart serves every company on the install.
