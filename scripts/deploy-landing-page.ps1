param(
  [string]$ServerIp = "95.111.253.90",
  [string]$Username = "root",
  [System.Management.Automation.PSCredential]$AdminCredential
)

$ErrorActionPreference = "Stop"

if (-not $AdminCredential) {
  throw "Credential is required. Example: Get-Credential | .\\scripts\\deploy-landing-page.ps1 -AdminCredential $_"
}

if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Install-Module -Name Posh-SSH -Scope CurrentUser -Force -AllowClobber -Confirm:$false
}

Import-Module Posh-SSH -Force

$session = New-SSHSession -ComputerName $ServerIp -Credential $AdminCredential -AcceptKey -ConnectionTimeout 30

if (-not $session) {
  throw "Could not open SSH session to $ServerIp"
}

try {
  $siteRoot = "/var/www/erdataya/site"
  $tmpZip = "/tmp/erdataye-site.zip"
  $localZip = Join-Path $env:TEMP "erdataye-site.zip"

  if (Test-Path $localZip) { Remove-Item $localZip -Force }
  Compress-Archive -Path "website/landing/*" -DestinationPath $localZip -Force

  $scp = New-SFTPSession -ComputerName $ServerIp -Credential $AdminCredential -AcceptKey
  Set-SFTPFile -SessionId $scp.SessionId -LocalFile $localZip -RemotePath $tmpZip -Overwrite

  $cmd = @"
set -e
mkdir -p $siteRoot
unzip -o $tmpZip -d $siteRoot >/dev/null
rm -f $tmpZip

# Keep APK aliases stable
mkdir -p /var/www/erdataya/downloads

# Install nginx vhost from repository template.
cat > /etc/nginx/sites-available/erdataye-site.conf <<'NGINXCONF'
$(Get-Content -Path "website/nginx/erdataye-site.conf" -Raw)
NGINXCONF

ln -sf /etc/nginx/sites-available/erdataye-site.conf /etc/nginx/sites-enabled/erdataye-site.conf

nginx -t
systemctl reload nginx
"@

  $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 180000

  "Landing page deployed successfully."
  $result.Output
  "Open: http://$ServerIp"
  "APK: http://$ServerIp/downloads/erdataye.apk"
  "Staff dashboard: http://$ServerIp/staff"

  Remove-SFTPSession -SessionId $scp.SessionId | Out-Null
}
finally {
  Remove-SSHSession -SessionId $session.SessionId | Out-Null
}
