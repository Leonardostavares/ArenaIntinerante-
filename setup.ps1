# ============================================================
# setup.ps1 - Instalador automatico do ArenaIntinerante
# Basta clicar com botao direito -> "Executar com PowerShell"
# (ou rodar ./setup.ps1 dentro da pasta do projeto)
# ============================================================

Write-Host "=== Configurando o projeto ArenaIntinerante ===" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------
# 1) Verificar se o Node.js esta instalado
# ------------------------------------------------------------
function Test-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

if (Test-Command "node") {
    $nodeVersion = node -v
    Write-Host "[OK] Node.js ja instalado ($nodeVersion)" -ForegroundColor Green
} else {
    Write-Host "[..] Node.js nao encontrado. Instalando automaticamente..." -ForegroundColor Yellow

    if (Test-Command "winget") {
        winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        Write-Host "[OK] Node.js instalado via winget." -ForegroundColor Green
        Write-Host "     Feche e reabra este terminal (PowerShell) e rode o script de novo para continuar." -ForegroundColor Yellow
        exit
    } else {
        Write-Host "[ERRO] winget nao disponivel neste computador." -ForegroundColor Red
        Write-Host "Baixe e instale o Node.js manualmente em: https://nodejs.org (versao LTS)" -ForegroundColor Red
        Write-Host "Depois de instalar, feche este terminal, abra um novo e rode o script novamente." -ForegroundColor Red
        exit 1
    }
}

# ------------------------------------------------------------
# 2) Verificar se o Git esta instalado (so um aviso, ja que
#    quem esta rodando esse script provavelmente ja clonou)
# ------------------------------------------------------------
if (Test-Command "git") {
    Write-Host "[OK] Git ja instalado." -ForegroundColor Green
} else {
    Write-Host "[AVISO] Git nao encontrado. Nao e necessario pra rodar o app," -ForegroundColor Yellow
    Write-Host "        mas sera necessario se for atualizar o codigo depois (git pull)." -ForegroundColor Yellow
    if (Test-Command "winget") {
        Write-Host "        Instalando Git automaticamente..." -ForegroundColor Yellow
        winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
    }
}

# ------------------------------------------------------------
# 3) Instalar as dependencias do projeto
# ------------------------------------------------------------
Write-Host ""
Write-Host "[..] Instalando dependencias do projeto (npm install)..." -ForegroundColor Cyan
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] Falha ao instalar dependencias. Verifique as mensagens acima." -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Dependencias instaladas." -ForegroundColor Green

# ------------------------------------------------------------
# 4) Corrigir versoes com o Expo (garante compatibilidade)
# ------------------------------------------------------------
Write-Host ""
Write-Host "[..] Ajustando versoes com o Expo (expo install --fix)..." -ForegroundColor Cyan
npx expo install --fix

# ------------------------------------------------------------
# 5) Finalizado
# ------------------------------------------------------------
Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host " Tudo pronto! Para abrir o app agora, rode:" -ForegroundColor Green
Write-Host "     npm start" -ForegroundColor White
Write-Host " Depois escaneie o QR code com o app Expo Go no celular." -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green