# seeds/

One-time migration data. **Nothing in here is tracked in git** (see
`.gitignore`: `seeds/*.seed.json`), and that is deliberate.

## Why

`routes/nonGlParties/index.js` used to carry its seed inline: ~23,000 lines of
real party records — company names, street addresses, email addresses, mobile
numbers — pasted directly under the `/createNonglPartiesInBulk` handler. Five
routes, then 23,000 lines of somebody else's personal data.

That is third-party PII in a source repository. It gets cloned, built into the
sealed bytecode tree, and shipped to customer sites, and once committed it is
in history permanently whether or not the line is later deleted. Extracting it
to an ignored file means the route still works for whoever needs to run the
migration, without the data riding along in every checkout.

## Files

| File | Used by | Records |
|---|---|---|
| `nonGlParties.seed.json` | `POST /nonGlParties/createNonglPartiesInBulk` | 1,361 |

Shape: a JSON array of objects with `PartyTypeId`, `code`, `name`, `person1`,
`zip`, `telephone1`, `telephone2`, `mobile1`, `mobile2`, `infoMail`, `website`,
`operations`, `types`, `address1`, `address2`.

## Running a seed

Drop the file in this directory and POST to the route as a CEO/CFO/admin user.
The response reports what actually happened:

```json
{ "status": "partial", "result": { "total": 1361, "created": 1359, "failed": [ ... ] } }
```

`status` is `"success"` only when every record inserted. If the file is absent
the route returns 404 rather than reporting a seed it never ran.

## If you no longer need this

Delete the seed file and the route. It is migration scaffolding from the
Climax cutover, not a product feature.

## Note on history

Removing the data from the working tree does not remove it from commits that
already contain it. If this repository's history is ever published or handed
over, that history still holds the records and needs rewriting
(`git filter-repo --path Odyssey-Backend-Server/routes/nonGlParties/index.js`
or similar) — the sooner the cheaper.
