"""Real public portal checks. Never installs virtual authenticators or signs transactions."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select

root = Path(__file__).resolve().parents[2]
out = root / 'data' / 'selenium-qa'
out.mkdir(parents=True, exist_ok=True)
options = webdriver.ChromeOptions()
options.add_argument('--headless=new')
options.add_argument('--disable-gpu')
options.add_argument('--no-first-run')
options.add_argument(f'--user-data-dir={out / "browser-profile"}')
options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
driver = webdriver.Chrome(options=options)
wait = WebDriverWait(driver, 45)
checks = []
company = os.environ.get('SHIFT_PAY_EMPLOYER_ADDRESS', '0x430ff06AB045911e5dC6B7a742ddC11f27F47487')

def ready(text):
    wait.until(lambda d: text in d.find_element(By.TAG_NAME, 'body').text)

try:
    driver.set_window_size(1280, 1000)
    business = 'https://shiftpay-business.vercel.app'
    employee = 'https://shiftpay-employee.vercel.app'
    for role, origin, sections in [
        ('employer', business, ['', 'employees', 'payroll', 'funding', 'payments', 'shifts', 'reports', 'settings']),
        ('employee', employee, ['', 'earnings', 'shifts', 'payments', 'profile']),
    ]:
        driver.get(origin)
        ready('payroll setup pending')
        assert driver.current_url.rstrip('/').endswith('/' + role)
        checks.append(f'{role}: dedicated root redirect')
        for section in sections:
            driver.get(origin + '/' + role + ('/' + section if section else ''))
            ready('payroll setup pending')
            assert len(driver.find_elements(By.CSS_SELECTOR, '.product-nav a')) == len(sections)
            assert not driver.find_elements(By.CSS_SELECTOR, 'button.take')
            checks.append(f'{role}/{section}: real setup state, no invented wages')
        driver.get(origin + '/' + role)
        ready('payroll setup pending')
        for width in [390, 320]:
            driver.set_window_size(width, 844)
            assert driver.execute_script('return document.documentElement.scrollWidth <= window.innerWidth')
            driver.save_screenshot(str(out / f'{role}-{width}.png'))
        checks.append(f'{role}: mobile layouts at 390 and 320')
        driver.set_window_size(1280, 1000)
        login = wait.until(lambda d: next((b for b in d.find_elements(By.TAG_NAME, 'button') if b.text == 'Log in' and b.is_enabled()), None))
        login.click()
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, 'input[type=email]') or 'Continue with email' in d.find_element(By.TAG_NAME, 'body').text)
        checks.append(f'{role}: email login opens without submitting email')

    driver.get(business + '/deploy')
    ready('Create payroll passkey')
    name = driver.find_element(By.CSS_SELECTOR, 'input[autocomplete=organization]')
    name.clear()
    name.send_keys('zepto')
    select = Select(driver.find_element(By.CSS_SELECTOR, '.setup-card select'))
    for asset in ['AUSD', 'USDC']:
        select.select_by_visible_text(asset)
        assert select.first_selected_option.text == asset
        assert not driver.find_element(By.CSS_SELECTOR, '.setup-actions .primary').is_enabled()
    checks.append('Company: actual currency selection; registration requires unlocked owner passkey')
    assert not driver.find_elements(By.CSS_SELECTOR, 'option[value=metamask]')
    checks.append('Company: no external MetaMask account connection')
    driver.save_screenshot(str(out / 'company-setup.png'))

    # Read-only actual RPC, using the owner's provided public address.
    driver.set_script_timeout(30)
    result = driver.execute_async_script("""
      const address=arguments[0],done=arguments[arguments.length-1];
      fetch('https://testnet-rpc.monad.xyz/',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBalance',params:[address,'latest']})})
        .then(async response=>({status:response.status,data:await response.json()}))
        .then(done).catch(error=>done({error:error.message}));
    """, company)
    assert result.get('status') == 200 and 'result' in result.get('data', {}), result
    checks.append('Company: live browser RPC can read actual public account balance')
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'checks': checks,
              'company': company, 'nativeBalanceWei': str(int(result['data']['result'], 16)),
              'scope': 'Unauthenticated public UI and real RPC reads. Owner passkey confirmation and funded settlement remain separate.',
              'browserErrors': [entry for entry in driver.get_log('browser') if entry['level'] == 'SEVERE']}
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f'PASS: {len(checks)} Selenium checks. Actual company MON balance: {report["nativeBalanceWei"]} wei.')
finally:
    driver.quit()
