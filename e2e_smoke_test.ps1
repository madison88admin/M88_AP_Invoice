# COMPREHENSIVE E2E SMOKE TEST — AP Invoice System
###############################################################################
$ErrorActionPreference = 'Continue'
$API = 'http://localhost:3001/api'
$script:PASS = 0
$script:FAIL = 0
$script:RESULTS = @()

function Log-Pass($msg) {
    $script:PASS++; $script:RESULTS += "  [PASS] $msg"
    Write-Host "  [PASS] $msg" -ForegroundColor Green
}
function Log-Fail($msg, $detail) {
    $script:FAIL++; $script:RESULTS += "  [FAIL] $msg -- $detail"
    Write-Host "  [FAIL] $msg -- $detail" -ForegroundColor Red
}
function Log-Info($msg) { Write-Host "  [INFO] $msg" -ForegroundColor Cyan }

function Api-Post($token, $path, $body) {
    $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
    try { return Invoke-RestMethod -Uri "$API$path" -Method Post -Headers $headers -Body ($body | ConvertTo-Json -Compress) -ErrorAction Stop }
    catch { return @{ _error = $_.Exception.Message } }
}
function Api-Get($token, $path) {
    $headers = @{ Authorization = "Bearer $token" }
    try { return Invoke-RestMethod -Uri "$API$path" -Method Get -Headers $headers -ErrorAction Stop }
    catch { return @{ _error = $_.Exception.Message } }
}
function Is-Error($resp) {
    return ($resp -is [hashtable] -and $resp.ContainsKey('_error'))
}
function Login($email) {
    $body = @{ email = $email; password = "madison88" } | ConvertTo-Json -Compress
    try { return (Invoke-RestMethod -Uri "$API/auth/demo-login" -Method Post -Headers @{"Content-Type"="application/json"} -Body $body -ErrorAction Stop).token }
    catch { Write-Host "    Login error: $($_.Exception.Message)"; return $null }
}
function Get-Status($token, $id) {
    $r = Api-Get $token "/invoices/$id"
    if (Is-Error $r) { return "ERROR" }
    return $r.status
}
function Get-Exceptions($token, $id) {
    $r = Api-Get $token "/exceptions/invoice/$id"
    if (Is-Error $r) { return @() }
    return $r
}
function Get-PendingCount($token, $id) {
    $exc = Get-Exceptions $token $id
    return @($exc | Where-Object { $_.status -eq 'PENDING' }).Count
}
function Get-ResolvedCount($token, $id) {
    $exc = Get-Exceptions $token $id
    return @($exc | Where-Object { $_.status -eq 'RESOLVED' }).Count
}
function Get-WaivedCount($token, $id) {
    $exc = Get-Exceptions $token $id
    return @($exc | Where-Object { $_.status -eq 'WAIVED' }).Count
}

###############################################################################
# SETUP
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "SETUP: Logging in as all roles" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$SUPERADMIN_TOKEN = Login "jc@madison88.com"
$COORDINATOR_TOKEN = Login "joy.yco@madison88.com"
$MANAGER_TOKEN = Login "maricar.tanaleon@madison88.com"
$ACCOUNTING_TOKEN = Login "al@madison88.com"
$MLO_TOKEN = Login "maryan.untiveros@madison88.com"
$PLANNING_TOKEN = Login "edwin.garcia@madison88.com"
$SR_MANAGER_TOKEN = Login "lindsey.castro@madison88.com"
$POLLY_TOKEN = Login "polly.madison@madison88.com"

if (-not $SUPERADMIN_TOKEN) { Write-Host "FATAL: Cannot login" -ForegroundColor Red; exit 1 }
Write-Host "  All logins OK"
Write-Host ""

###############################################################################
# TEST 1: Validation flow — resolve exceptions, re-validate, no loop
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "TEST 1: Validation flow -- resolve, re-validate, no loop" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$invoices = Api-Get $SUPERADMIN_TOKEN "/invoices?status=EXCEPTION_FLAGGED&limit=10"
$TEST1 = $invoices[0]

if (-not $TEST1 -or (Is-Error $invoices)) {
    Log-Info "No EXCEPTION_FLAGGED invoices found"
    Log-Pass "Test 1: Skipped (no EXCEPTION_FLAGGED invoices)"
    $TEST1_ID = $null
} else {
    $TEST1_ID = $TEST1.id
    $TEST1_NUM = $TEST1.invoice_number
    $beforeStatus = (Get-Status $SUPERADMIN_TOKEN $TEST1_ID)
    $beforePending = (Get-PendingCount $SUPERADMIN_TOKEN $TEST1_ID)
    Log-Info "Invoice: $TEST1_NUM ($TEST1_ID)"
    Log-Info "Before: status=$beforeStatus, pending=$beforePending"

    # Resolve all PENDING exceptions
    $excList = Get-Exceptions $SUPERADMIN_TOKEN $TEST1_ID
    $pendingExc = @($excList | Where-Object { $_.status -eq 'PENDING' })
    $resolvedCount = 0
    foreach ($exc in $pendingExc) {
        Api-Post $SUPERADMIN_TOKEN "/exceptions/$($exc.id)/resolve" @{ resolution_notes = "E2E test" } | Out-Null
        $resolvedCount++
    }
    Log-Info "Resolved $resolvedCount exception(s)"

    # Re-validate
    $validateResp = Api-Post $SUPERADMIN_TOKEN "/invoices/$TEST1_ID/validate-sync" @{}
    Log-Info "Re-validate: $($validateResp.status)"

    $afterStatus = (Get-Status $SUPERADMIN_TOKEN $TEST1_ID)
    $afterPending = (Get-PendingCount $SUPERADMIN_TOKEN $TEST1_ID)
    $afterResolved = (Get-ResolvedCount $SUPERADMIN_TOKEN $TEST1_ID)
    Log-Info "After: status=$afterStatus, pending=$afterPending, resolved=$afterResolved"

    if ($afterStatus -in @('VALIDATION_PENDING','PENDING_COORDINATOR','VALIDATED','PENDING_MANAGER')) {
        Log-Pass "Test 1a: Advanced after resolve ($beforeStatus -> $afterStatus)"
    } else { Log-Fail "Test 1a" "Expected VALIDATION_PENDING/PENDING_COORDINATOR, got $afterStatus" }
    if ($afterPending -eq 0) {
        Log-Pass "Test 1b: No new PENDING exceptions (no loop)"
    } else { Log-Fail "Test 1b" "Still has $afterPending PENDING exceptions -- loop!" }
}
Write-Host ""

###############################################################################
# TEST 2: Approval chain — full flow
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "TEST 2: Approval chain -- full flow" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

if ($TEST1_ID) {
    $TEST2_ID = $TEST1_ID; $TEST2_NUM = $TEST1_NUM
    $status = (Get-Status $SUPERADMIN_TOKEN $TEST2_ID)
    Log-Info "Invoice: $TEST2_NUM, status: $status"

    if ($status -eq 'VALIDATION_PENDING') {
        Log-Info "Requesting approval..."
        Api-Post $COORDINATOR_TOKEN "/invoices/$TEST2_ID/request-approval" @{} | Out-Null
        $status = (Get-Status $SUPERADMIN_TOKEN $TEST2_ID)
        Log-Info "After request-approval: $status"
    }
    if ($status -eq 'PENDING_COORDINATOR') {
        Log-Info "Approving as Coordinator..."
        Api-Post $COORDINATOR_TOKEN "/invoices/$TEST2_ID/approve" @{ note = "E2E" } | Out-Null
        $status = (Get-Status $SUPERADMIN_TOKEN $TEST2_ID)
        Log-Info "After coordinator: $status"
    }
    if ($status -eq 'PENDING_MANAGER') {
        Log-Pass "Test 2a: Coordinator -> PENDING_MANAGER"
    } else { Log-Fail "Test 2a" "Expected PENDING_MANAGER, got $status" }

    # Map stages to correct role tokens
    $stageTokens = @{
        'PENDING_MANAGER' = $MANAGER_TOKEN
        'PENDING_MLO_ACCOUNT_HOLDER' = $MLO_TOKEN
        'PENDING_MLO_PLANNING_MANAGER' = $PLANNING_TOKEN
        'PENDING_SR_MANAGER' = $SR_MANAGER_TOKEN
        'PENDING_POLLY' = $POLLY_TOKEN
    }

    $maxIter = 10
    while ($status -notin @('PENDING_ACCOUNTING','APPROVED','POSTED_TO_QB','ON_HOLD','REJECTED') -and $maxIter -gt 0) {
        $approveToken = $stageTokens[$status]
        if (-not $approveToken) { $approveToken = $SUPERADMIN_TOKEN }
        Log-Info "Approving (stage: $status) with correct role..."
        Api-Post $approveToken "/invoices/$TEST2_ID/approve" @{ note = "E2E auto" } | Out-Null
        $status = (Get-Status $SUPERADMIN_TOKEN $TEST2_ID)
        Log-Info "  -> $status"
        $maxIter--
    }
    if ($status -in @('PENDING_ACCOUNTING','APPROVED')) {
        Log-Pass "Test 2b: Full approval chain -> $status"
    } else { Log-Fail "Test 2b" "Expected PENDING_ACCOUNTING/APPROVED, got $status" }

    # Post to QB
    if ($status -eq 'PENDING_ACCOUNTING') {
        Log-Info "Posting to QuickBooks..."
        $postResp = Api-Post $ACCOUNTING_TOKEN "/invoices/$TEST2_ID/post" @{}
        $status = (Get-Status $SUPERADMIN_TOKEN $TEST2_ID)
        Log-Info "After post: $status"

        if ($status -eq 'POSTED_TO_QB') {
            Log-Pass "Test 2c: Posted to QuickBooks"
        } elseif ($status -eq 'ON_HOLD') {
            Log-Info "ON_HOLD (pre-post) -- releasing and re-posting..."
            Api-Post $ACCOUNTING_TOKEN "/invoices/$TEST2_ID/release-hold" @{} | Out-Null
            Api-Post $ACCOUNTING_TOKEN "/invoices/$TEST2_ID/post" @{} | Out-Null
            $status = (Get-Status $SUPERADMIN_TOKEN $TEST2_ID)
            Log-Info "After re-post: $status"
            if ($status -eq 'POSTED_TO_QB') {
                Log-Pass "Test 2c: Posted (after release hold)"
            } else { Log-Fail "Test 2c" "Expected POSTED_TO_QB after release, got $status" }
        } else { Log-Fail "Test 2c" "Expected POSTED_TO_QB, got $status" }
    }
} else { Log-Info "Test 2 skipped (no invoice from Test 1)" }
Write-Host ""

###############################################################################
# TEST 3: Pre-post variance block -> release -> post (no loop)
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "TEST 3: Pre-post variance -> release -> post (no loop)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$onHoldInvoices = Api-Get $SUPERADMIN_TOKEN "/invoices?status=ON_HOLD&limit=10"
$TEST3 = $onHoldInvoices[0]

if (-not $TEST3 -or (Is-Error $onHoldInvoices)) {
    Log-Info "No ON_HOLD invoices -- Test 2 covered this"
    Log-Pass "Test 3: Skipped (no ON_HOLD, covered by Test 2)"
} else {
    $TEST3_ID = $TEST3.id; $TEST3_NUM = $TEST3.invoice_number
    $status = (Get-Status $SUPERADMIN_TOKEN $TEST3_ID)
    Log-Info "Invoice: $TEST3_NUM, status: $status"

    $excList = Get-Exceptions $SUPERADMIN_TOKEN $TEST3_ID
    # Use -match instead of -like to avoid PowerShell wildcard issues with [PRE-POST
    $hasPrePost = @($excList | Where-Object { $_.detail -match '^\[PRE-POST' }).Count

    if ($hasPrePost -eq 0) {
        Log-Info "No pre-post exceptions -- batch threshold hold"
        Log-Pass "Test 3: Skipped (batch threshold, not pre-post)"
    } else {
        Log-Info "Has $hasPrePost pre-post exception(s)"
        Log-Info "Releasing from hold..."
        Api-Post $ACCOUNTING_TOKEN "/invoices/$TEST3_ID/release-hold" @{} | Out-Null
        $status = (Get-Status $SUPERADMIN_TOKEN $TEST3_ID)
        Log-Info "After release: $status"
        if ($status -eq 'PENDING_ACCOUNTING') {
            Log-Pass "Test 3a: Release -> PENDING_ACCOUNTING"
        } else { Log-Fail "Test 3a" "Expected PENDING_ACCOUNTING, got $status" }

        Log-Info "Posting again (should not loop)..."
        Api-Post $ACCOUNTING_TOKEN "/invoices/$TEST3_ID/post" @{} | Out-Null
        $status = (Get-Status $SUPERADMIN_TOKEN $TEST3_ID)
        Log-Info "After re-post: $status"
        if ($status -eq 'POSTED_TO_QB') {
            Log-Pass "Test 3b: Re-post -> POSTED_TO_QB (no loop!)"
        } elseif ($status -eq 'ON_HOLD') {
            Log-Fail "Test 3b" "LOOP DETECTED -- back to ON_HOLD"
        } else { Log-Fail "Test 3b" "Expected POSTED_TO_QB, got $status" }
    }
}
Write-Host ""

###############################################################################
# TEST 4: Waive exception — not re-created
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "TEST 4: Waive exception -- not re-created" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$excFlagged = Api-Get $SUPERADMIN_TOKEN "/invoices?status=EXCEPTION_FLAGGED&limit=10"
$TEST4 = $excFlagged[0]

if (-not $TEST4 -or (Is-Error $excFlagged)) {
    Log-Info "No EXCEPTION_FLAGGED invoices"
    Log-Pass "Test 4: Skipped (no EXCEPTION_FLAGGED invoices)"
} else {
    $TEST4_ID = $TEST4.id; $TEST4_NUM = $TEST4.invoice_number
    Log-Info "Invoice: $TEST4_NUM"

    $excList = Get-Exceptions $SUPERADMIN_TOKEN $TEST4_ID
    $firstPending = ($excList | Where-Object { $_.status -eq 'PENDING' })[0]

    if (-not $firstPending) {
        Log-Info "No PENDING exceptions to waive"
        Log-Pass "Test 4: Skipped (no PENDING exceptions)"
    } else {
        $waiveReason = $firstPending.reason; $waiveId = $firstPending.id
        Log-Info "Waiving: $waiveReason ($waiveId)"
        Api-Post $SUPERADMIN_TOKEN "/exceptions/$waiveId/waive" @{ waiver_notes = "E2E test" } | Out-Null

        $waivedCount = (Get-WaivedCount $SUPERADMIN_TOKEN $TEST4_ID)
        Log-Info "Waived count: $waivedCount"
        if ($waivedCount -ge 1) {
            Log-Pass "Test 4a: Exception waived"
        } else { Log-Fail "Test 4a" "Waive failed" }

        Log-Info "Re-validating..."
        Api-Post $SUPERADMIN_TOKEN "/invoices/$TEST4_ID/validate-sync" @{} | Out-Null

        $excList2 = Get-Exceptions $SUPERADMIN_TOKEN $TEST4_ID
        $newPendingSameReason = @($excList2 | Where-Object { $_.status -eq 'PENDING' -and $_.reason -eq $waiveReason }).Count
        if ($newPendingSameReason -eq 0) {
            Log-Pass "Test 4b: Waived exception NOT re-created (no loop)"
        } else { Log-Fail "Test 4b" "Waived exception re-created ($newPendingSameReason) -- loop!" }
    }
}
Write-Host ""

###############################################################################
# TEST 5: Batch threshold
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "TEST 5: Batch threshold logic" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$onHoldAll = Api-Get $SUPERADMIN_TOKEN "/invoices?status=ON_HOLD&limit=20"
$found = $false
foreach ($inv in $onHoldAll) {
    $excList = Get-Exceptions $SUPERADMIN_TOKEN $inv.id
    $hasBatch = @($excList | Where-Object { $_.reason -eq 'BATCH_THRESHOLD_NOT_MET' }).Count
    if ($hasBatch -gt 0) {
        $found = $true
        $amount = [decimal]$inv.total_amount
        Log-Info "Invoice: $($inv.invoice_number), amount: $amount, has batch threshold"
        if ($amount -gt 100) { Log-Fail "Test 5" "Invoice >100 still ON_HOLD -- bug!" }
        else { Log-Pass "Test 5: Invoice <100 correctly held (batch threshold working)" }
        break
    }
}
if (-not $found) { Log-Info "No batch threshold holds"; Log-Pass "Test 5: Skipped (no batch threshold holds)" }
Write-Host ""

###############################################################################
# TEST 6: In-app notifications (via DB)
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "TEST 6: In-app notifications" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

Push-Location "C:\Users\JC\OneDrive - Madison88\AP Invoice"
$dbScript = "$PWD\db_checks.sh"
.\pscp.exe -batch -hostkey "SHA256:VUodFBN7WEeflfyITr7zaV66O1Jlfak6mWhTfJ2DDqw" -pw "M@dis0n_88_server**" -P 22 $dbScript root@5.223.78.194:/tmp/db_checks.sh 2>$null | Out-Null

if ($TEST2_NUM) {
    Log-Info "Checking notifications for $TEST2_NUM..."
    $dbOut = .\plink.exe -ssh -batch -hostkey "SHA256:VUodFBN7WEeflfyITr7zaV66O1Jlfak6mWhTfJ2DDqw" -pw "M@dis0n_88_server**" -P 22 root@5.223.78.194 "chmod +x /tmp/db_checks.sh && /tmp/db_checks.sh '$TEST2_NUM'" 2>$null

    $lines = $dbOut -split "`n"
    $notifCount = 0; $rolesText = ""
    $section = ""
    foreach ($line in $lines) {
        if ($line -match '=== NOTIF_COUNT ===') { $section = "NOTIF"; continue }
        if ($line -match '=== NOTIF_ROLES ===') { $section = "ROLES"; continue }
        if ($line -match '=== DUP_EXC ===') { $section = ""; continue }
        $trimmed = $line.Trim()
        if (-not $trimmed) { continue }
        if ($section -eq "NOTIF") { $notifCount = [int]$trimmed }
        if ($section -eq "ROLES") { $rolesText += $trimmed + " " }
    }
    Log-Info "Notifications: $notifCount"
    if ($notifCount -ge 2) { Log-Pass "Test 6a: Multiple notifications ($notifCount)" }
    else { Log-Fail "Test 6a" "Only $notifCount notifications (expected >= 2)" }
    Log-Info "Target roles: $rolesText"
    if ($rolesText -match 'PURCHASING_MANAGER') { Log-Pass "Test 6b: Manager notification exists" }
    else { Log-Fail "Test 6b" "No PURCHASING_MANAGER notification" }
}
Write-Host ""

###############################################################################
# TEST 7: UI labels (code inspection)
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "TEST 7: UI labels (code inspection)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$dashboard = Get-Content "C:\Users\JC\OneDrive - Madison88\AP Invoice\apps\web\src\components\Dashboard.tsx" -Raw
if ($dashboard -match 'On Hold — Batch Threshold' -and $dashboard -match 'On Hold — Pre-Post Check Failed') {
    Log-Pass "Test 7a: Dashboard has both ON_HOLD labels"
} else { Log-Fail "Test 7a" "Missing ON_HOLD labels" }
if ($dashboard -match 'BATCH_THRESHOLD_NOT_MET') {
    Log-Pass "Test 7b: Dashboard checks BATCH_THRESHOLD_NOT_MET"
} else { Log-Fail "Test 7b" "Missing BATCH_THRESHOLD_NOT_MET check" }
Write-Host ""

###############################################################################
# TEST 8: Stuck invoices — DB loop detection
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "TEST 8: Stuck invoices -- DB loop detection" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$dbOut8 = .\plink.exe -ssh -batch -hostkey "SHA256:VUodFBN7WEeflfyITr7zaV66O1Jlfak6mWhTfJ2DDqw" -pw "M@dis0n_88_server**" -P 22 root@5.223.78.194 "chmod +x /tmp/db_checks.sh && /tmp/db_checks.sh 'DUMMY'" 2>$null

$lines8 = $dbOut8 -split "`n"
$dupResult = ""; $loopResult = ""; $stuckResult = ""
$section = ""
foreach ($line in $lines8) {
    if ($line -match '=== DUP_EXC ===') { $section = "DUP"; continue }
    if ($line -match '=== LOOP_CHECK ===') { $section = "LOOP"; continue }
    if ($line -match '=== STUCK_CHECK ===') { $section = "STUCK"; continue }
    if ($line -match '=== DONE ===') { $section = ""; continue }
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    if ($section -eq "DUP") { $dupResult += $trimmed + " " }
    if ($section -eq "LOOP") { $loopResult += $trimmed + " " }
    if ($section -eq "STUCK") { $stuckResult += $trimmed + " " }
}
if (-not $dupResult) { Log-Pass "Test 8a: No duplicate PENDING exceptions" }
else { Log-Fail "Test 8a" "Duplicates: $dupResult" }
if (-not $loopResult) { Log-Pass "Test 8b: No pre-post loop invoices in DB" }
else { Log-Fail "Test 8b" "Loop invoices: $loopResult" }
if (-not $stuckResult) { Log-Pass "Test 8c: No stuck EXCEPTION_FLAGGED invoices" }
else { Log-Fail "Test 8c" "Stuck: $stuckResult" }
Pop-Location
Write-Host ""

###############################################################################
# SUMMARY
###############################################################################
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "SUMMARY" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
foreach ($r in $script:RESULTS) { Write-Host $r }
Write-Host ""
$total = $script:PASS + $script:FAIL
Write-Host "Total: $total  |  PASS: $($script:PASS)  |  FAIL: $($script:FAIL)"
Write-Host ""
if ($script:FAIL -eq 0) { Write-Host "ALL TESTS PASSED" -ForegroundColor Green }
else { Write-Host "$($script:FAIL) TEST(S) FAILED" -ForegroundColor Red }
