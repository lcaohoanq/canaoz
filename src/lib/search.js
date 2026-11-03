export const STUDENT_ID_REGEX = /^[A-Za-z]{2}[0-9]{6}$/;

export function normalizeName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyQuery(value = '') {
  const query = String(value).trim();
  if (!query) return { kind: 'empty', value: '' };
  if (STUDENT_ID_REGEX.test(query)) return { kind: 'id', value: query.toUpperCase() };
  if (/^[A-Za-z]+\d/.test(query)) return { kind: 'invalid-id', value: query };
  if (normalizeName(query).length < 2) return { kind: 'short-name', value: query };
  return { kind: 'name', value: query };
}

export function maskStudentId(value = '') {
  const id = String(value).toUpperCase();
  return STUDENT_ID_REGEX.test(id) ? `${id.slice(0, 2)}****${id.slice(-2)}` : '********';
}

export function filterRecords(records, query, shift) {
  const parsed = classifyQuery(query);
  if (parsed.kind === 'short-name' || parsed.kind === 'invalid-id') return [];
  return records
    .filter((record) => !shift || Number(record.shift) === Number(shift))
    .filter((record) => {
      if (parsed.kind === 'empty') return Boolean(shift);
      if (parsed.kind === 'id') return String(record.studentId).toUpperCase() === parsed.value;
      return normalizeName(record.name).includes(normalizeName(parsed.value));
    })
    .map(({ name, studentId, shift: recordShift, group }) => ({
      name,
      studentIdMasked: maskStudentId(studentId),
      shift: recordShift,
      group: group || '',
    }))
    .slice(0, 40);
}
