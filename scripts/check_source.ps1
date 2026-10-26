$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$requiredPaths = @('backend/main.py','backend/ml.py','backend/data.py','backend/reporting.py','backend/requirements.txt','frontend/src/main.tsx','frontend/src/style.css','frontend/package.json','README.md','data/README.md','.env.example','.github/workflows/verify.yml')
foreach ($relativePath in $requiredPaths) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoPath $relativePath))) { throw "Missing source: $relativePath" }
}
$package = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoPath 'frontend/package.json') | ConvertFrom-Json
if (-not $package.scripts.build) { throw 'Missing frontend build script' }
$null = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoPath 'frontend/tsconfig.json') | ConvertFrom-Json
$null = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoPath 'frontend/vercel.json') | ConvertFrom-Json
$apiText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoPath 'backend/main.py')
foreach ($route in @('/api/health','/api/datasets','/api/datasets/upload','/api/datasets/{dataset_id}/train','/api/jobs/{key}','/api/datasets/{key}/predict','/api/datasets/{key}/report')) {
    if (-not $apiText.Contains($route)) { throw "Missing API contract: $route" }
}
$uiText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoPath 'frontend/src/main.tsx')
foreach ($stage in @('Overview','Data Understanding','Data Preparation','Feature Selection','Modeling','Evaluation','Prediction','CRISP-DM Report')) {
    if (-not $uiText.Contains($stage)) { throw "Missing UI stage: $stage" }
}
$startupPath = Join-Path $repoPath 'data/50_Startups.csv'
if (Test-Path -LiteralPath $startupPath) {
    $startup = Import-Csv -LiteralPath $startupPath
    if ($startup.Count -ne 50 -or @($startup[0].PSObject.Properties).Count -ne 5) { throw 'Unexpected startup CSV schema' }
    if (-not ($startup[0].PSObject.Properties.Name -contains 'Profit')) { throw 'Missing startup target' }
    Write-Output 'Cached startup CSV: 50 rows; five columns; Profit target.'
}
Write-Output 'Source checks passed: required files, JSON configuration, API routes and all eight UI stages.'
Write-Output 'These checks do not compile TypeScript, execute Python, or validate statistical output.'
