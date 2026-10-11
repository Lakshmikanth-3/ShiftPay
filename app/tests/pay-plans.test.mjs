import test from 'node:test';
import assert from 'node:assert/strict';
import {salaryToHourly,isSalaried,SALARY_MAX_SECONDS,SHIFT_MAX_SECONDS,SALARY_HOURS_PER_MONTH} from '../lib/pay-plans.mjs';

test('monthly salary converts to an hourly rate over a 30-day month',()=>{
  assert.equal(salaryToHourly('720'),'1.000000');
  assert.equal(salaryToHourly('3000'),'4.166666');
  assert.equal(salaryToHourly('50000'),'69.444444');
});
test('a month of accrual at the converted rate never exceeds the salary',()=>{
  for(const m of ['1','99.99','3000','50000']){
    const hourly=BigInt(salaryToHourly(m).replace('.',''));const month=BigInt(Math.round(Number(m)*1e6));
    const accrued=hourly*BigInt(SALARY_HOURS_PER_MONTH);assert.ok(accrued<=month&&month-accrued<BigInt(SALARY_HOURS_PER_MONTH),m);
  }
});
test('invalid salaries are rejected',()=>{for(const v of ['','0','-5','abc'])assert.throws(()=>salaryToHourly(v));});
test('salaried workers are recognised by their accrual period',()=>{
  assert.equal(isSalaried({maxShiftSeconds:SALARY_MAX_SECONDS}),true);
  assert.equal(isSalaried({maxShiftSeconds:SHIFT_MAX_SECONDS}),false);
  assert.ok(SALARY_MAX_SECONDS<2**32);
});
