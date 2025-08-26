import deepObjEq from 'fast-deep-equal';

/**
 * Converts a Date object to a string in 'YYYY-MM-DD' format.
 * @param date The date to convert.
 * @returns The formatted date string, or an empty string if the date is null or invalid.
 */
export function dateToString(date: Date | null | undefined): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a string in 'YYYY-MM-DD' format to a Date object.
 * @param dateString The string to convert.
 * @returns The Date object, or null if the string is empty or invalid.
 */
export function stringToDate(dateString: string | null | undefined): Date {
  if (!dateString || typeof dateString !== 'string') {
    return new Date();
  }
  const parts = dateString.split('-');
  if (parts.length !== 3) {
    return new Date();
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

export { deepObjEq };

// export function deepObjEq(obj1: Object, obj2: Object) {
//   const sortedKeys1 = Object.keys(obj1).sort();
//   const jsonString1 = JSON.stringify(obj1, sortedKeys1);
//   const sortedKeys2 = Object.keys(obj2).sort();
//   const jsonString2 = JSON.stringify(obj2, sortedKeys2);
//   return jsonString1 === jsonString2;
// }
