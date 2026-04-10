# Domain Setup Plan (Without Affecting Mobile App)

This setup keeps your Android app behavior unchanged and adds:

- A public landing website on your root domain
- A dedicated subdomain for staff/admin web dashboard
- Stable APK download links

## 1. Recommended Domain Structure

- Root website: `erdataye.com`
- Landing mirror: `www.erdataye.com`
- Staff dashboard: `staff.erdataye.com`
- Optional admin alias: `admin.erdataye.com`

## 2. DNS Records

At your domain provider, create:

- `A` record: `@` -> `207.180.205.85`
- `A` record: `www` -> `207.180.205.85`
- `A` record: `staff` -> `207.180.205.85`
- Optional `A` record: `admin` -> `207.180.205.85`

## 3. Deploy Landing Site Files

From your project root:

```powershell
.\scripts\deploy-landing-page.ps1 -Password "YOUR_VPS_PASSWORD" -Domain "erdataye.com" -WwwDomain "www.erdataye.com" -StaffDomain "staff.erdataye.com"
```

This script:

- Uploads `website/landing` to `/var/www/erdataya/site`
- Installs nginx vhosts from `website/nginx/`
- Reloads nginx after config validation
- Preserves `/api` proxy and APK links

## 4. Add HTTPS (Let’s Encrypt)

On VPS after DNS propagation:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erdataye.com -d www.erdataye.com -d staff.erdataye.com -d admin.erdataye.com
```

Then test:

- `https://erdataye.com`
- `https://erdataye.com/erdataye.apk`
- `https://staff.erdataye.com`

## 5. Keep Mobile App Stable

No mobile rebuild is required for this website addition.
If you want the app API base changed to domain later, do it in a separate controlled release.

## 6. Notes About Staff Dashboard

Your app currently returns `404` on `/staff` at VPS root. That means dashboard static build is not currently deployed there.

When your staff web build is ready, upload it to:

- `/var/www/erdataya/staff`

Nginx is already prepared in `website/nginx/staff-dashboard.conf`.
