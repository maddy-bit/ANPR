/**
 * Plate Normalization Utility
 * Standardizes vehicle registration plates: strips whitespace, hyphens, special chars, uppercase.
 */

function normalize(plate) {
  if (!plate || typeof plate !== 'string') {
    return '';
  }
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  normalize,
};
