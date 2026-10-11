// Pay plans. Both accrue every second on chain; a monthly salary is one long accrual period.
export const SHIFT_MAX_SECONDS=8*3600;            // a shift closes within 8 hours
export const SALARY_MAX_SECONDS=31*24*3600;       // a salary period covers up to one calendar month
export const SALARY_HOURS_PER_MONTH=720;          // 30 days x 24 hours: salary grows every second, day and night

/** Hourly rate (token decimal string) that pays `monthly` over a 30-day month. */
export function salaryToHourly(monthly,decimals=6){
  if(!/^\d+(\.\d+)?$/.test(String(monthly).trim()))throw new Error('Enter a monthly salary.');
  const [whole,frac='']=String(monthly).trim().split('.');
  const units=BigInt(whole)*10n**BigInt(decimals)+BigInt((frac+'0'.repeat(decimals)).slice(0,decimals)||'0');
  if(units<=0n)throw new Error('Monthly salary must be positive.');
  const hourly=units/BigInt(SALARY_HOURS_PER_MONTH);
  const s=hourly.toString().padStart(decimals+1,'0');
  return s.slice(0,-decimals)+'.'+s.slice(-decimals);
}
export const isSalaried=worker=>Number(worker?.maxShiftSeconds??0)>24*3600;
