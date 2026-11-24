# syntax=docker/dockerfile:1

# ============ builder: install, point at the customer's backend, build ============
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# The frontend bakes absolute NEXT_PUBLIC_* backend URLs at build time. Rewrite
# the placeholder host (http://localhost:8088, used in .env) to the customer's
# actual backend address, passed as a build arg.
#
# THE BUILD FAILS IF THE PLACEHOLDER IS NOT THERE, and that guard is the whole
# point of this step rather than an afterthought.
#
# .env is TRACKED, and a developer pointing it at their own machine
# (192.168.50.22:8088) to work locally is normal and correct. Committing that
# is the accident: the replace below then matches nothing, BACKEND_URL does
# NOTHING, and every image for every install ships pointing at that developer's
# laptop. Nothing errors. The site loads, login works, and every browser talks
# to the wrong backend - one customer's staff quietly reading another's data,
# or a machine that is simply off.
#
# There is no way to detect that after the fact from the image, so it is caught
# here, where the fix is one line of git.
ARG BACKEND_URL=http://localhost:8088
ENV BACKEND_URL=$BACKEND_URL
# The release these screens are, from the tag CI builds - shown in the header
# beside the server's own (functions/appVersion), so an install whose two
# images are on different releases says so. NEXT_PUBLIC_*, so `next build`
# writes it into the bundle.
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV NEXT_OUTPUT_STANDALONE=true
RUN node -e "\
const fs=require('fs'); const f='.env'; const ph='http://localhost:8088'; \
if(!fs.existsSync(f)) throw new Error('.env is missing - the build has no URLs to rewrite.'); \
let s=fs.readFileSync(f,'utf8'); \
const n=s.split(ph).length-1; \
if(n===0) throw new Error( \
  'REFUSING TO BUILD: .env contains no \"'+ph+'\" to replace, so BACKEND_URL='+process.env.BACKEND_URL+ \
  ' would be ignored and this image would ship pointing wherever .env already points. '+ \
  'A dev .env has almost certainly been committed - restore it with: git checkout -- .env'); \
s=s.split(ph).join(process.env.BACKEND_URL); \
fs.writeFileSync(f,s); \
console.log('backend URL set to '+process.env.BACKEND_URL+' ('+n+' occurrences)');"
RUN npm run build

# ============ runtime: minimal standalone server =================================
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Next.js standalone output bundles its own minimal node_modules.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
