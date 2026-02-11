import { extractCountersFromMember, calculateNextCounterValue } from './counters';
import { Member, initMember } from './data-model';

function test(name: string, actual: any, expected: any) {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    if (passed) {
        console.log(`PASS: ${name}`);
    } else {
        console.error(`FAIL: ${name}`);
        console.error(`  Expected: ${JSON.stringify(expected)}`);
        console.error(`  Actual:   ${JSON.stringify(actual)}`);
        process.exit(1);
    }
}

console.log('Running parsing tests...');

test('Parses standard US ID', extractCountersFromMember({ ...initMember(), memberId: 'US100' }), { memberIdCountryCode: 'US', memberIdNumber: 100, instructorIdNumber: undefined });
test('Parses UK ID (mixed case)', extractCountersFromMember({ ...initMember(), memberId: 'uk50' }), { memberIdCountryCode: 'UK', memberIdNumber: 50, instructorIdNumber: undefined });
test('Parses Instructor ID', extractCountersFromMember({ ...initMember(), instructorId: '200' }), { memberIdCountryCode: undefined, memberIdNumber: undefined, instructorIdNumber: 200 });
test('Parses Both', extractCountersFromMember({ ...initMember(), memberId: 'DE99', instructorId: '300' }), { memberIdCountryCode: 'DE', memberIdNumber: 99, instructorIdNumber: 300 });
test('Ignores invalid Member ID', extractCountersFromMember({ ...initMember(), memberId: 'INVALID' }), { memberIdCountryCode: undefined, memberIdNumber: undefined, instructorIdNumber: undefined });
test('Ignores invalid Instructor ID', extractCountersFromMember({ ...initMember(), instructorId: 'ABC' }), { memberIdCountryCode: undefined, memberIdNumber: undefined, instructorIdNumber: undefined });
test('Handles empty', extractCountersFromMember(initMember()), { memberIdCountryCode: undefined, memberIdNumber: undefined, instructorIdNumber: undefined });

console.log('Running counter calculation tests...');

const MIN = 100;
test('Calculation: lastSeen < currentCounter < MIN', calculateNextCounterValue(50, 80, MIN), 100);
test('Calculation: currentCounter < lastSeen < MIN', calculateNextCounterValue(90, 80, MIN), 100);
test('Calculation: lastSeen+1 > currentCounter (both > MIN)', calculateNextCounterValue(150, 120, MIN), 151);
test('Calculation: lastSeen+1 < currentCounter (both > MIN)', calculateNextCounterValue(110, 150, MIN), 150);
test('Calculation: lastSeen exactly at currentCounter', calculateNextCounterValue(150, 150, MIN), 151);

console.log('All tests passed!');
