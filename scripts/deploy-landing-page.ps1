param(
  [string]$ServerIp = "207.180.205.85",
  [string]$Username = "root",
  [string]$Password,
  [string]$Domain = "erdataye.com",
  [string]$WwwDomain = "www.erdataye.com",
  [string]$StaffDomain = "staff.erdataye.com"
)

$ErrorActionPreference = "Stop"

if (-not $Password) {
  throw "Password is required. Example: .\\scripts\\deploy-landing-page.ps1 -Password 'your-pass'"
}

if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Install-Module -Name Posh-SSH -Scope CurrentUser -Force -AllowClobber -Confirm:$false
}

Import-Module Posh-SSH -Force

$sec = ConvertTo-SecureString $Password -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($Username, $sec)
$session = New-SSHSession -ComputerName $ServerIp -Credential $cred -AcceptKey -ConnectionTimeout 30

if (-not $session) {
  throw "Could not open SSH session to $ServerIp"
}

try {
  $siteRoot = "/var/www/erdataya/site"
  $tmpZip = "/tmp/erdataye-site.zip"
  $localZip = Join-Path $env:TEMP "erdataye-site.zip"

  if (Test-Path $localZip) { Remove-Item $localZip -Force }
  Compress-Archive -Path "website/landing/*" -DestinationPath $localZip -Force

  $scp = New-SFTPSession -ComputerName $ServerIp -Credential $cred -AcceptKey
  Set-SFTPFile -SessionId $scp.SessionId -LocalFile $localZip -RemotePath $tmpZip -Overwrite

  $cmd = @"
set -e
mkdir -p $siteRoot
unzip -o $tmpZip -d $siteRoot >/dev/null
rm -f $tmpZip

# Keep APK aliases stable
mkdir -p /var/www/erdataya/downloads

# Install nginx vhost from repository templates (domain placeholders replaced)
cat > /etc/nginx/sites-available/erdataye-site.conf <<'NGINXCONF'
$(Get-Content -Path "website/nginx/erdataye-site.conf" -Raw)
NGINXCONF

cat > /etc/nginx/sites-available/staff-dashboard.conf <<'NGINXSTAFF'
$(Get-Content -Path "website/nginx/staff-dashboard.conf" -Raw)
NGINXSTAFF

sed -i "s/erdataye.com/$Domain/g" /etc/nginx/sites-available/erdataye-site.conf
sed -i "s/www.erdataye.com/$WwwDomain/g" /etc/nginx/sites-available/erdataye-site.conf
sed -i "s/staff.erdataye.com/$StaffDomain/g" /etc/nginx/sites-available/staff-dashboard.conf
sed -i "s/admin.erdataye.com/admin.$Domain/g" /etc/nginx/sites-available/staff-dashboard.conf

ln -sf /etc/nginx/sites-available/erdataye-site.conf /etc/nginx/sites-enabled/erdataye-site.conf
ln -sf /etc/nginx/sites-available/staff-dashboard.conf /etc/nginx/sites-enabled/staff-dashboard.conf

nginx -t
systemctl reload nginx
"@

  $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 180000

  "Landing page deployed successfully."
  $result.Output
  "Open: http://$Domain"
  "APK: http://$Domain/erdataye.apk"
  "Staff dashboard target: http://$StaffDomain"

  Remove-SFTPSession -SessionId $scp.SessionId | Out-Null
}
finally {
  Remove-SSHSession -SessionId $session.SessionId | Out-Null
}
