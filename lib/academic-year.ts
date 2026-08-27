export function getCurrentAcademicYear(date = new Date()) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 7 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
