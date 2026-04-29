$ErrorActionPreference = "Stop"

function Test-Endpoint($name, $method, $url, $headers, $body, $expected) {
  $headerArgs = @()
  foreach ($k in $headers.Keys) { $headerArgs += @("-H", "$($k): $($headers[$k])") }
  $tmpFile = [System.IO.Path]::GetTempFileName()
  # Pass body via stdin (--data-binary @-) untuk hindarin PowerShell quoting issue
  if ($body) {
    $cmdArgs = @("-s", "-o", $tmpFile, "-w", "%{http_code}", "-X", $method) + $headerArgs + @("--data-binary", "@-", $url)
    $code = $body | & curl.exe $cmdArgs
  } else {
    $cmdArgs = @("-s", "-o", $tmpFile, "-w", "%{http_code}", "-X", $method) + $headerArgs + @($url)
    $code = & curl.exe $cmdArgs
  }
  $ok = ([int]$code -eq $expected)
  $status = if ($ok) { "PASS" } else { "FAIL" }
  Write-Host "[$status] $name -> $code (expected $expected)"
  if (-not $ok) {
    $respBody = (Get-Content $tmpFile -Raw -ErrorAction SilentlyContinue)
    if ($respBody) { Write-Host "  body: $respBody" }
  }
  Remove-Item $tmpFile -ErrorAction SilentlyContinue
  return $ok
}

$results = @()
$base = "http://localhost:4143"
$auth = "claude-pool-secret-2026"
$json = @{"Content-Type"="application/json"}
$authJson = @{"Authorization"="Bearer $auth"; "Content-Type"="application/json"}
$wrongJson = @{"Authorization"="Bearer wrong"; "Content-Type"="application/json"}
$msgBody = '{"model":"claude-3-haiku-20240307","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'

$results += Test-Endpoint "Health" "GET" "$base/health" @{} "" 200
$results += Test-Endpoint "Health detailed" "GET" "$base/health/detailed" @{} "" 200
$results += Test-Endpoint "Health ready empty pool" "GET" "$base/health/ready" @{} "" 503
$results += Test-Endpoint "Health live" "GET" "$base/health/live" @{} "" 200
$results += Test-Endpoint "Dashboard stats" "GET" "$base/api/dashboard/stats" @{} "" 200
$results += Test-Endpoint "Dashboard config GET" "GET" "$base/api/dashboard/config" @{} "" 200
$results += Test-Endpoint "Dashboard accounts list" "GET" "$base/api/dashboard/accounts" @{} "" 200
$results += Test-Endpoint "Dashboard usage" "GET" "$base/api/dashboard/usage" @{} "" 200
$results += Test-Endpoint "Dashboard cost" "GET" "$base/api/dashboard/cost" @{} "" 200
$results += Test-Endpoint "Dashboard history" "GET" "$base/api/dashboard/history" @{} "" 200
$results += Test-Endpoint "Dashboard notifications" "GET" "$base/api/dashboard/notifications" @{} "" 200
$results += Test-Endpoint "Dashboard logs" "GET" "$base/api/dashboard/logs" @{} "" 200
$results += Test-Endpoint "Dashboard status" "GET" "$base/api/dashboard/status" @{} "" 200
$results += Test-Endpoint "OAuth start ok" "POST" "$base/api/dashboard/oauth/start" $json '{"name":"smoke"}' 200
$results += Test-Endpoint "OAuth start no name" "POST" "$base/api/dashboard/oauth/start" $json '{}' 400
$results += Test-Endpoint "OAuth pending count" "GET" "$base/api/dashboard/oauth/pending" @{} "" 200
$results += Test-Endpoint "Set strategy invalid -> error" "PUT" "$base/api/dashboard/config" $json '{"strategy":"invalid-xyz"}' 500
$results += Test-Endpoint "Set strategy valid" "PUT" "$base/api/dashboard/config" $json '{"strategy":"weighted"}' 200
$results += Test-Endpoint "Set strategy back" "PUT" "$base/api/dashboard/config" $json '{"strategy":"round-robin"}' 200
$results += Test-Endpoint "v1/messages NO auth" "POST" "$base/v1/messages" $json '{}' 401
$results += Test-Endpoint "v1/messages WRONG auth" "POST" "$base/v1/messages" $wrongJson '{}' 401
$results += Test-Endpoint "v1/messages WRONG x-api-key" "POST" "$base/v1/messages" @{"x-api-key"="wrong"; "Content-Type"="application/json"} '{}' 401
$results += Test-Endpoint "v1/messages correct auth empty pool" "POST" "$base/v1/messages" $authJson $msgBody 503
$results += Test-Endpoint "Account update non-existent" "PUT" "$base/api/dashboard/accounts/nonexistent" $json '{"name":"x"}' 500
$results += Test-Endpoint "Account get non-existent" "GET" "$base/api/dashboard/accounts/nonexistent" @{} "" 404

$pass = ($results | Where-Object { $_ }).Count
$fail = ($results | Where-Object { -not $_ }).Count
Write-Host ""
Write-Host "==================================="
Write-Host "Summary: $pass PASS, $fail FAIL"
Write-Host "==================================="
if ($fail -gt 0) { exit 1 }
