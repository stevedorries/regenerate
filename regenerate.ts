export type SurrogateMapping = Array<number[][]>;

const ERRORS = {
  rangeOrder:
    "A range\u2019s `stop` value must be greater than or equal " +
    "to the `start` value.",
  codePointRange:
    "Invalid code point value. Code points range from " +
    "U+000000 to U+10FFFF."
};

// https://mathiasbynens.be/notes/javascript-encoding#surrogate-pairs
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

// In Regenerate output, `\0` is never preceded by `\` because we sort by
// code point value, so let’s keep this regular expression simple.
const regexNull = /\\x00([^0123456789]|$)/g;

function isNumber(x: any): x is number {
  return typeof x === "number";
}

// This assumes that `number` is a positive integer that `toString()`s nicely
// (which is the case for all code point values).
const zeroes = "0000";
function pad(number:number|string, totalCharacters:number) {
  var string = String(number);
  return string.length < totalCharacters
    ? (zeroes + string).slice(-totalCharacters)
    : string;
}

function hex(number: number | string) {
  return Number(number)
    .toString(16)
    .toUpperCase();
}

const slice = [].slice;

/*--------------------------------------------------------------------------*/

function dataFromCodePoints(codePoints: any[]) {
  var index = -1;
  var length = codePoints.length;
  var max = length - 1;
  var result = [];
  var isStart = true;
  var tmp;
  var previous = 0;
  while (++index < length) {
    tmp = codePoints[index];
    if (isStart) {
      result.push(tmp);
      previous = tmp;
      isStart = false;
    } else {
      if (tmp == previous + 1) {
        if (index != max) {
          previous = tmp;
          continue;
        } else {
          isStart = true;
          result.push(tmp + 1);
        }
      } else {
        // End the previous range and start a new one.
        result.push(previous + 1, tmp);
        previous = tmp;
      }
    }
  }
  if (!isStart) {
    result.push(tmp + 1);
  }
  return result;
}

function dataRemove(data: any[], codePoint: number) {
  // Iterate over the data per `(start, end)` pair.
  var index = 0;
  var start;
  var end;
  var length = data.length;
  while (index < length) {
    start = data[index];
    end = data[index + 1];
    if (codePoint >= start && codePoint < end) {
      // Modify this pair.
      if (codePoint == start) {
        if (end == start + 1) {
          // Just remove `start` and `end`.
          data.splice(index, 2);
          return data;
        } else {
          // Just replace `start` with a new value.
          data[index] = codePoint + 1;
          return data;
        }
      } else if (codePoint == end - 1) {
        // Just replace `end` with a new value.
        data[index + 1] = codePoint;
        return data;
      } else {
        // Replace `[start, end]` with `[startA, endA, startB, endB]`.
        data.splice(index, 2, start, codePoint, codePoint + 1, end);
        return data;
      }
    }
    index += 2;
  }
  return data;
}

function dataRemoveRange(data: any[], rangeStart: number, rangeEnd: number) {
  if (rangeEnd < rangeStart) {
    throw Error(ERRORS.rangeOrder);
  }
  // Iterate over the data per `(start, end)` pair.
  var index = 0;
  var start;
  var end;
  while (index < data.length) {
    start = data[index];
    end = data[index + 1] - 1; // Note: the `- 1` makes `end` inclusive.

    // Exit as soon as no more matching pairs can be found.
    if (start > rangeEnd) {
      return data;
    }

    // Check if this range pair is equal to, or forms a subset of, the range
    // to be removed.
    // E.g. we have `[0, 11, 40, 51]` and want to remove 0-10 → `[40, 51]`.
    // E.g. we have `[40, 51]` and want to remove 0-100 → `[]`.
    if (rangeStart <= start && rangeEnd >= end) {
      // Remove this pair.
      data.splice(index, 2);
      continue;
    }

    // Check if both `rangeStart` and `rangeEnd` are within the bounds of
    // this pair.
    // E.g. we have `[0, 11]` and want to remove 4-6 → `[0, 4, 7, 11]`.
    if (rangeStart >= start && rangeEnd < end) {
      if (rangeStart == start) {
        // Replace `[start, end]` with `[startB, endB]`.
        data[index] = rangeEnd + 1;
        data[index + 1] = end + 1;
        return data;
      }
      // Replace `[start, end]` with `[startA, endA, startB, endB]`.
      data.splice(index, 2, start, rangeStart, rangeEnd + 1, end + 1);
      return data;
    }

    // Check if only `rangeStart` is within the bounds of this pair.
    // E.g. we have `[0, 11]` and want to remove 4-20 → `[0, 4]`.
    if (rangeStart >= start && rangeStart <= end) {
      // Replace `end` with `rangeStart`.
      data[index + 1] = rangeStart;
      // Note: we cannot `return` just yet, in case any following pairs still
      // contain matching code points.
      // E.g. we have `[0, 11, 14, 31]` and want to remove 4-20
      // → `[0, 4, 21, 31]`.
    }

    // Check if only `rangeEnd` is within the bounds of this pair.
    // E.g. we have `[14, 31]` and want to remove 4-20 → `[21, 31]`.
    else if (rangeEnd >= start && rangeEnd <= end) {
      // Just replace `start`.
      data[index] = rangeEnd + 1;
      return data;
    }

    index += 2;
  }
  return data;
}

function dataAdd(data: number[], codePoint: number) {
  // Iterate over the data per `(start, end)` pair.
  var index = 0;
  var start;
  var end;
  var lastIndex = null;
  var length = data.length;
  if (codePoint < 0x0 || codePoint > 0x10ffff) {
    throw RangeError(ERRORS.codePointRange);
  }
  while (index < length) {
    start = data[index];
    end = data[index + 1];

    // Check if the code point is already in the set.
    if (codePoint >= start && codePoint < end) {
      return data;
    }

    if (codePoint == start - 1) {
      // Just replace `start` with a new value.
      data[index] = codePoint;
      return data;
    }

    // At this point, if `start` is `greater` than `codePoint`, insert a new
    // `[start, end]` pair before the current pair, or after the current pair
    // if there is a known `lastIndex`.
    if (start > codePoint) {
      data.splice(
        lastIndex != null ? lastIndex + 2 : 0,
        0,
        codePoint,
        codePoint + 1
      );
      return data;
    }

    if (codePoint == end) {
      // Check if adding this code point causes two separate ranges to become
      // a single range, e.g. `dataAdd([0, 4, 5, 10], 4)` → `[0, 10]`.
      if (codePoint + 1 == data[index + 2]) {
        data.splice(index, 4, start, data[index + 3]);
        return data;
      }
      // Else, just replace `end` with a new value.
      data[index + 1] = codePoint + 1;
      return data;
    }
    lastIndex = index;
    index += 2;
  }
  // The loop has finished; add the new pair to the end of the data set.
  data.push(codePoint, codePoint + 1);
  return data;
}

function dataAddData(dataA: any[], dataB: any[] | number[]) {
  // Iterate over the data per `(start, end)` pair.
  var index = 0;
  var start;
  var end;
  var data = dataA.slice();
  var length = dataB.length;
  while (index < length) {
    start = dataB[index];
    end = dataB[index + 1] - 1;
    if (start == end) {
      data = dataAdd(data, start);
    } else {
      data = dataAddRange(data, start, end);
    }
    index += 2;
  }
  return data;
}

function dataRemoveData(dataA: any[], dataB: any[]) {
  // Iterate over the data per `(start, end)` pair.
  var index = 0;
  var start;
  var end;
  var data = dataA.slice();
  var length = dataB.length;
  while (index < length) {
    start = dataB[index];
    end = dataB[index + 1] - 1;
    if (start == end) {
      data = dataRemove(data, start);
    } else {
      data = dataRemoveRange(data, start, end);
    }
    index += 2;
  }
  return data;
}

function dataAddRange(data: any[] | number[], rangeStart: number, rangeEnd: number) {
  if (rangeEnd < rangeStart) {
    throw Error(ERRORS.rangeOrder);
  }
  if (
    rangeStart < 0x0 ||
    rangeStart > 0x10ffff ||
    rangeEnd < 0x0 ||
    rangeEnd > 0x10ffff
  ) {
    throw RangeError(ERRORS.codePointRange);
  }
  // Iterate over the data per `(start, end)` pair.
  var index = 0;
  var start;
  var end;
  var added = false;
  var length = data.length;
  while (index < length) {
    start = data[index];
    end = data[index + 1];

    if (added) {
      // The range has already been added to the set; at this point, we just
      // need to get rid of the following ranges in case they overlap.

      // Check if this range can be combined with the previous range.
      if (start == rangeEnd + 1) {
        data.splice(index - 1, 2);
        return data;
      }

      // Exit as soon as no more possibly overlapping pairs can be found.
      if (start > rangeEnd) {
        return data;
      }

      // E.g. `[0, 11, 12, 16]` and we’ve added 5-15, so we now have
      // `[0, 16, 12, 16]`. Remove the `12,16` part, as it lies within the
      // `0,16` range that was previously added.
      if (start >= rangeStart && start <= rangeEnd) {
        // `start` lies within the range that was previously added.

        if (end > rangeStart && end - 1 <= rangeEnd) {
          // `end` lies within the range that was previously added as well,
          // so remove this pair.
          data.splice(index, 2);
          index -= 2;
          // Note: we cannot `return` just yet, as there may still be other
          // overlapping pairs.
        } else {
          // `start` lies within the range that was previously added, but
          // `end` doesn’t. E.g. `[0, 11, 12, 31]` and we’ve added 5-15, so
          // now we have `[0, 16, 12, 31]`. This must be written as `[0, 31]`.
          // Remove the previously added `end` and the current `start`.
          data.splice(index - 1, 2);
          index -= 2;
        }

        // Note: we cannot return yet.
      }
    } else if (start == rangeEnd + 1) {
      data[index] = rangeStart;
      return data;
    }

    // Check if a new pair must be inserted *before* the current one.
    else if (start > rangeEnd) {
      data.splice(index, 0, rangeStart, rangeEnd + 1);
      return data;
    } else if (rangeStart >= start && rangeStart < end && rangeEnd + 1 <= end) {
      // The new range lies entirely within an existing range pair. No action
      // needed.
      return data;
    } else if (
      // E.g. `[0, 11]` and you add 5-15 → `[0, 16]`.
      (rangeStart >= start && rangeStart < end) ||
      // E.g. `[0, 3]` and you add 3-6 → `[0, 7]`.
      end == rangeStart
    ) {
      // Replace `end` with the new value.
      data[index + 1] = rangeEnd + 1;
      // Make sure the next range pair doesn’t overlap, e.g. `[0, 11, 12, 14]`
      // and you add 5-15 → `[0, 16]`, i.e. remove the `12,14` part.
      added = true;
      // Note: we cannot `return` just yet.
    } else if (rangeStart <= start && rangeEnd + 1 >= end) {
      // The new range is a superset of the old range.
      data[index] = rangeStart;
      data[index + 1] = rangeEnd + 1;
      added = true;
    }

    index += 2;
  }
  // The loop has finished without doing anything; add the new pair to the end
  // of the data set.
  if (!added) {
    data.push(rangeStart, rangeEnd + 1);
  }
  return data;
}

function dataContains(data: number[], codePoint: number) {
  var index = 0;
  var length = data.length;
  // Exit early if `codePoint` is not within `data`’s overall range.
  var start = data[index];
  var end = data[length - 1];
  if (length >= 2) {
    if (codePoint < start || codePoint > end) {
      return false;
    }
  }
  // Iterate over the data per `(start, end)` pair.
  while (index < length) {
    start = data[index];
    end = data[index + 1];
    if (codePoint >= start && codePoint < end) {
      return true;
    }
    index += 2;
  }
  return false;
}

function dataIntersection(data: number[], codePoints: any[]) {
  var index = 0;
  var length = codePoints.length;
  var codePoint;
  var result = [];
  while (index < length) {
    codePoint = codePoints[index];
    if (dataContains(data, codePoint)) {
      result.push(codePoint);
    }
    ++index;
  }
  return dataFromCodePoints(result);
}

function dataIsEmpty(data: any[]) {
  return !data.length;
}

function dataIsSingleton(data: any[] | number[]) {
  // Check if the set only represents a single code point.
  return data.length == 2 && data[0] + 1 == data[1];
}

function dataToArray(data: number[]) {
  // Iterate over the data per `(start, end)` pair.
  var index = 0;
  var start;
  var end;
  var result = [];
  var length = data.length;
  while (index < length) {
    start = data[index];
    end = data[index + 1];
    while (start < end) {
      result.push(start);
      ++start;
    }
    index += 2;
  }
  return result;
}

/*--------------------------------------------------------------------------*/

// https://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
const floor = Math.floor;
function highSurrogate(codePoint: number) {
  return parseInt(
    `${floor((codePoint - 0x10000) / 0x400) + HIGH_SURROGATE_MIN}`,
    10
  );
}

function lowSurrogate(codePoint: number) {
  return parseInt(`${((codePoint - 0x10000) % 0x400) + LOW_SURROGATE_MIN}`, 10);
}

const stringFromCharCode = String.fromCharCode;
function codePointToString(codePoint: number) {
  var string;
  // https://mathiasbynens.be/notes/javascript-escapes#single
  // Note: the `\b` escape sequence for U+0008 BACKSPACE in strings has a
  // different meaning in regular expressions (word boundary), so it cannot
  // be used here.
  if (codePoint == 0x09) {
    string = "\\t";
  }
  // Note: IE < 9 treats `'\v'` as `'v'`, so avoid using it.
  // else if (codePoint == 0x0B) {
  // 	string = '\\v';
  // }
  else if (codePoint == 0x0a) {
    string = "\\n";
  } else if (codePoint == 0x0c) {
    string = "\\f";
  } else if (codePoint == 0x0d) {
    string = "\\r";
  } else if (codePoint == 0x2d) {
    // https://mathiasbynens.be/notes/javascript-escapes#hexadecimal
    // Note: `-` (U+002D HYPHEN-MINUS) is escaped in this way rather
    // than by backslash-escaping, in case the output is used outside
    // of a character class in a `u` RegExp. /\-/u throws, but
    // /\x2D/u is fine.
    string = "\\x2D";
  } else if (codePoint == 0x5c) {
    string = "\\\\";
  } else if (
    codePoint == 0x24 ||
    (codePoint >= 0x28 && codePoint <= 0x2b) ||
    codePoint == 0x2e ||
    codePoint == 0x2f ||
    codePoint == 0x3f ||
    (codePoint >= 0x5b && codePoint <= 0x5e) ||
    (codePoint >= 0x7b && codePoint <= 0x7d)
  ) {
    // The code point maps to an unsafe printable ASCII character;
    // backslash-escape it. Here’s the list of those symbols:
    //
    //     $()*+./?[\]^{|}
    //
    // This matches SyntaxCharacters as well as `/` (U+002F SOLIDUS).
    // https://tc39.github.io/ecma262/#prod-SyntaxCharacter
    string = "\\" + stringFromCharCode(codePoint);
  } else if (codePoint >= 0x20 && codePoint <= 0x7e) {
    // The code point maps to one of these printable ASCII symbols
    // (including the space character):
    //
    //      !"#%&',/0123456789:;<=>@ABCDEFGHIJKLMNO
    //     PQRSTUVWXYZ_`abcdefghijklmnopqrstuvwxyz~
    //
    // These can safely be used directly.
    string = stringFromCharCode(codePoint);
  } else if (codePoint <= 0xff) {
    string = "\\x" + pad(hex(codePoint), 2);
  } else {
    // `codePoint <= 0xFFFF` holds true.
    // https://mathiasbynens.be/notes/javascript-escapes#unicode
    string = "\\u" + pad(hex(codePoint), 4);
  }

  // There’s no need to account for astral symbols / surrogate pairs here,
  // since `codePointToString` is private and only used for BMP code points.
  // But if that’s what you need, just add an `else` block with this code:
  //
  //     string = '\\u' + pad(hex(highSurrogate(codePoint)), 4)
  //     	+ '\\u' + pad(hex(lowSurrogate(codePoint)), 4);

  return string;
}

function codePointToStringUnicode(codePoint: number) {
  if (codePoint <= 0xffff) {
    return codePointToString(codePoint);
  }
  return "\\u{" + codePoint.toString(16).toUpperCase() + "}";
}

function symbolToCodePoint(symbol: string) {
  var length = symbol.length;
  var first = symbol.charCodeAt(0);
  var second;
  if (
    first >= HIGH_SURROGATE_MIN &&
    first <= HIGH_SURROGATE_MAX &&
    length > 1 // There is a next code unit.
  ) {
    // `first` is a high surrogate, and there is a next character. Assume
    // it’s a low surrogate (else it’s invalid usage of Regenerate anyway).
    second = symbol.charCodeAt(1);
    // https://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
    return (
      (first - HIGH_SURROGATE_MIN) * 0x400 +
      second -
      LOW_SURROGATE_MIN +
      0x10000
    );
  }
  return first;
}

function createBMPCharacterClasses(data: any[] | number[]) {
  // Iterate over the data per `(start, end)` pair.
  var result = "";
  var index = 0;
  var start;
  var end;
  var length = data.length;
  if (dataIsSingleton(data)) {
    return codePointToString(data[0]);
  }
  while (index < length) {
    start = data[index];
    end = data[index + 1] - 1; // Note: the `- 1` makes `end` inclusive.
    if (start == end) {
      result += codePointToString(start);
    } else if (start + 1 == end) {
      result += codePointToString(start) + codePointToString(end);
    } else {
      result += codePointToString(start) + "-" + codePointToString(end);
    }
    index += 2;
  }
  return "[" + result + "]";
}

function createUnicodeCharacterClasses(data: number[]) {
  // Iterate over the data per `(start, end)` pair.
  var result = "";
  var index = 0;
  var start;
  var end;
  var length = data.length;
  if (dataIsSingleton(data)) {
    return codePointToStringUnicode(data[0]);
  }
  while (index < length) {
    start = data[index];
    end = data[index + 1] - 1; // Note: the `- 1` makes `end` inclusive.
    if (start == end) {
      result += codePointToStringUnicode(start);
    } else if (start + 1 == end) {
      result += codePointToStringUnicode(start) + codePointToStringUnicode(end);
    } else {
      result +=
        codePointToStringUnicode(start) + "-" + codePointToStringUnicode(end);
    }
    index += 2;
  }
  return "[" + result + "]";
}

function splitAtBMP(data: number[]) {
  // Iterate over the data per `(start, end)` pair.
  var loneHighSurrogates = [];
  var loneLowSurrogates = [];
  var bmp = [];
  var astral = [];
  var index = 0;
  var start;
  var end;
  var length = data.length;
  while (index < length) {
    start = data[index];
    end = data[index + 1] - 1; // Note: the `- 1` makes `end` inclusive.

    if (start < HIGH_SURROGATE_MIN) {
      // The range starts and ends before the high surrogate range.
      // E.g. (0, 0x10).
      if (end < HIGH_SURROGATE_MIN) {
        bmp.push(start, end + 1);
      }

      // The range starts before the high surrogate range and ends within it.
      // E.g. (0, 0xD855).
      if (end >= HIGH_SURROGATE_MIN && end <= HIGH_SURROGATE_MAX) {
        bmp.push(start, HIGH_SURROGATE_MIN);
        loneHighSurrogates.push(HIGH_SURROGATE_MIN, end + 1);
      }

      // The range starts before the high surrogate range and ends in the low
      // surrogate range. E.g. (0, 0xDCFF).
      if (end >= LOW_SURROGATE_MIN && end <= LOW_SURROGATE_MAX) {
        bmp.push(start, HIGH_SURROGATE_MIN);
        loneHighSurrogates.push(HIGH_SURROGATE_MIN, HIGH_SURROGATE_MAX + 1);
        loneLowSurrogates.push(LOW_SURROGATE_MIN, end + 1);
      }

      // The range starts before the high surrogate range and ends after the
      // low surrogate range. E.g. (0, 0x10FFFF).
      if (end > LOW_SURROGATE_MAX) {
        bmp.push(start, HIGH_SURROGATE_MIN);
        loneHighSurrogates.push(HIGH_SURROGATE_MIN, HIGH_SURROGATE_MAX + 1);
        loneLowSurrogates.push(LOW_SURROGATE_MIN, LOW_SURROGATE_MAX + 1);
        if (end <= 0xffff) {
          bmp.push(LOW_SURROGATE_MAX + 1, end + 1);
        } else {
          bmp.push(LOW_SURROGATE_MAX + 1, 0xffff + 1);
          astral.push(0xffff + 1, end + 1);
        }
      }
    } else if (start >= HIGH_SURROGATE_MIN && start <= HIGH_SURROGATE_MAX) {
      // The range starts and ends in the high surrogate range.
      // E.g. (0xD855, 0xD866).
      if (end >= HIGH_SURROGATE_MIN && end <= HIGH_SURROGATE_MAX) {
        loneHighSurrogates.push(start, end + 1);
      }

      // The range starts in the high surrogate range and ends in the low
      // surrogate range. E.g. (0xD855, 0xDCFF).
      if (end >= LOW_SURROGATE_MIN && end <= LOW_SURROGATE_MAX) {
        loneHighSurrogates.push(start, HIGH_SURROGATE_MAX + 1);
        loneLowSurrogates.push(LOW_SURROGATE_MIN, end + 1);
      }

      // The range starts in the high surrogate range and ends after the low
      // surrogate range. E.g. (0xD855, 0x10FFFF).
      if (end > LOW_SURROGATE_MAX) {
        loneHighSurrogates.push(start, HIGH_SURROGATE_MAX + 1);
        loneLowSurrogates.push(LOW_SURROGATE_MIN, LOW_SURROGATE_MAX + 1);
        if (end <= 0xffff) {
          bmp.push(LOW_SURROGATE_MAX + 1, end + 1);
        } else {
          bmp.push(LOW_SURROGATE_MAX + 1, 0xffff + 1);
          astral.push(0xffff + 1, end + 1);
        }
      }
    } else if (start >= LOW_SURROGATE_MIN && start <= LOW_SURROGATE_MAX) {
      // The range starts and ends in the low surrogate range.
      // E.g. (0xDCFF, 0xDDFF).
      if (end >= LOW_SURROGATE_MIN && end <= LOW_SURROGATE_MAX) {
        loneLowSurrogates.push(start, end + 1);
      }

      // The range starts in the low surrogate range and ends after the low
      // surrogate range. E.g. (0xDCFF, 0x10FFFF).
      if (end > LOW_SURROGATE_MAX) {
        loneLowSurrogates.push(start, LOW_SURROGATE_MAX + 1);
        if (end <= 0xffff) {
          bmp.push(LOW_SURROGATE_MAX + 1, end + 1);
        } else {
          bmp.push(LOW_SURROGATE_MAX + 1, 0xffff + 1);
          astral.push(0xffff + 1, end + 1);
        }
      }
    } else if (start > LOW_SURROGATE_MAX && start <= 0xffff) {
      // The range starts and ends after the low surrogate range.
      // E.g. (0xFFAA, 0x10FFFF).
      if (end <= 0xffff) {
        bmp.push(start, end + 1);
      } else {
        bmp.push(start, 0xffff + 1);
        astral.push(0xffff + 1, end + 1);
      }
    } else {
      // The range starts and ends in the astral range.
      astral.push(start, end + 1);
    }

    index += 2;
  }
  return {
    loneHighSurrogates: loneHighSurrogates,
    loneLowSurrogates: loneLowSurrogates,
    bmp: bmp,
    astral: astral
  };
}

function optimizeSurrogateMappings(surrogateMappings: SurrogateMapping): SurrogateMapping {
  let result = [];
  let tmpLow = [];
  let addLow = false;
  let mapping;
  let nextMapping;
  let highSurrogates;
  let lowSurrogates;
  let nextHighSurrogates;
  let nextLowSurrogates;
  let index = -1;
  let length = surrogateMappings.length;
  while (++index < length) {
    mapping = surrogateMappings[index];
    nextMapping = surrogateMappings[index + 1];
    if (!nextMapping) {
      result.push(mapping);
      continue;
    }
    highSurrogates = mapping[0];
    lowSurrogates = mapping[1];
    nextHighSurrogates = nextMapping[0];
    nextLowSurrogates = nextMapping[1];

    // Check for identical high surrogate ranges.
    tmpLow = lowSurrogates;
    while (
      nextHighSurrogates &&
      highSurrogates[0] == nextHighSurrogates[0] &&
      highSurrogates[1] == nextHighSurrogates[1]
    ) {
      // Merge with the next item.
      if (dataIsSingleton(nextLowSurrogates)) {
        tmpLow = dataAdd(tmpLow, nextLowSurrogates[0]);
      } else {
        tmpLow = dataAddRange(
          tmpLow,
          nextLowSurrogates[0],
          nextLowSurrogates[1] - 1
        );
      }
      ++index;
      mapping = surrogateMappings[index];
      highSurrogates = mapping[0];
      lowSurrogates = mapping[1];
      nextMapping = surrogateMappings[index + 1];
      nextHighSurrogates = nextMapping && nextMapping[0];
      nextLowSurrogates = nextMapping && nextMapping[1];
      addLow = true;
    }
    result.push([highSurrogates, addLow ? tmpLow : lowSurrogates]);
    addLow = false;
  }
  return optimizeByLowSurrogates(result);
}

function optimizeByLowSurrogates(surrogateMappings: SurrogateMapping) {
  if (surrogateMappings.length == 1) {
    return surrogateMappings;
  }
  var index = -1;
  var innerIndex = -1;
  while (++index < surrogateMappings.length) {
    var mapping = surrogateMappings[index];
    var lowSurrogates = mapping[1];
    var lowSurrogateStart = lowSurrogates[0];
    var lowSurrogateEnd = lowSurrogates[1];
    innerIndex = index; // Note: the loop starts at the next index.
    while (++innerIndex < surrogateMappings.length) {
      var otherMapping = surrogateMappings[innerIndex];
      var otherLowSurrogates = otherMapping[1];
      var otherLowSurrogateStart = otherLowSurrogates[0];
      var otherLowSurrogateEnd = otherLowSurrogates[1];
      if (
        lowSurrogateStart == otherLowSurrogateStart &&
        lowSurrogateEnd == otherLowSurrogateEnd
      ) {
        // Add the code points in the other item to this one.
        if (dataIsSingleton(otherMapping[0])) {
          mapping[0] = dataAdd(mapping[0], otherMapping[0][0]);
        } else {
          mapping[0] = dataAddRange(
            mapping[0],
            otherMapping[0][0],
            otherMapping[0][1] - 1
          );
        }
        // Remove the other, now redundant, item.
        surrogateMappings.splice(innerIndex, 1);
        --innerIndex;
      }
    }
  }
  return surrogateMappings;
}

function surrogateSet(data: number[]): SurrogateMapping {
  // Exit early if `data` is an empty set.
  if (!data.length) {
    return [];
  }

  // Iterate over the data per `(start, end)` pair.
  var index = 0;
  var start;
  var end;
  var startHigh;
  var startLow;
  var endHigh;
  var endLow;
  let surrogateMappings = [];
  var length = data.length;
  while (index < length) {
    start = data[index];
    end = data[index + 1] - 1;

    startHigh = highSurrogate(start);
    startLow = lowSurrogate(start);
    endHigh = highSurrogate(end);
    endLow = lowSurrogate(end);

    var startsWithLowestLowSurrogate = startLow == LOW_SURROGATE_MIN;
    var endsWithHighestLowSurrogate = endLow == LOW_SURROGATE_MAX;
    var complete = false;

    // Append the previous high-surrogate-to-low-surrogate mappings.
    // Step 1: `(startHigh, startLow)` to `(startHigh, LOW_SURROGATE_MAX)`.
    if (
      startHigh == endHigh ||
      (startsWithLowestLowSurrogate && endsWithHighestLowSurrogate)
    ) {
      surrogateMappings.push([
        [startHigh, endHigh + 1],
        [startLow, endLow + 1]
      ]);
      complete = true;
    } else {
      surrogateMappings.push([
        [startHigh, startHigh + 1],
        [startLow, LOW_SURROGATE_MAX + 1]
      ]);
    }

    // Step 2: `(startHigh + 1, LOW_SURROGATE_MIN)` to
    // `(endHigh - 1, LOW_SURROGATE_MAX)`.
    if (!complete && startHigh + 1 < endHigh) {
      if (endsWithHighestLowSurrogate) {
        // Combine step 2 and step 3.
        surrogateMappings.push([
          [startHigh + 1, endHigh + 1],
          [LOW_SURROGATE_MIN, endLow + 1]
        ]);
        complete = true;
      } else {
        surrogateMappings.push([
          [startHigh + 1, endHigh],
          [LOW_SURROGATE_MIN, LOW_SURROGATE_MAX + 1]
        ]);
      }
    }

    // Step 3. `(endHigh, LOW_SURROGATE_MIN)` to `(endHigh, endLow)`.
    if (!complete) {
      surrogateMappings.push([
        [endHigh, endHigh + 1],
        [LOW_SURROGATE_MIN, endLow + 1]
      ]);
    }

    index += 2;
  }

  // The format of `surrogateMappings` is as follows:
  //
  //     [ surrogateMapping1, surrogateMapping2 ]
  //
  // i.e.:
  //
  //     [
  //       [ highSurrogates1, lowSurrogates1 ],
  //       [ highSurrogates2, lowSurrogates2 ]
  //     ]
  return optimizeSurrogateMappings(surrogateMappings);
}

function createSurrogateCharacterClasses(surrogateMappings: SurrogateMapping) {
  const result = surrogateMappings.map(surrogateMapping => {
    var highSurrogates = surrogateMapping[0];
    var lowSurrogates = surrogateMapping[1];
    return [
      createBMPCharacterClasses(highSurrogates) +
        createBMPCharacterClasses(lowSurrogates)
    ];
  });
  return result.join("|");
}

function createCharacterClassesFromData(data: number[], bmpOnly: boolean, hasUnicodeFlag: boolean) {
  if (hasUnicodeFlag) {
    return createUnicodeCharacterClasses(data);
  }
  var result = [];

  var parts = splitAtBMP(data);
  var loneHighSurrogates = parts.loneHighSurrogates;
  var loneLowSurrogates = parts.loneLowSurrogates;
  var bmp = parts.bmp;
  var astral = parts.astral;
  var hasLoneHighSurrogates = !dataIsEmpty(loneHighSurrogates);
  var hasLoneLowSurrogates = !dataIsEmpty(loneLowSurrogates);

  var surrogateMappings: SurrogateMapping = surrogateSet(astral);

  if (bmpOnly) {
    bmp = dataAddData(bmp, loneHighSurrogates);
    hasLoneHighSurrogates = false;
    bmp = dataAddData(bmp, loneLowSurrogates);
    hasLoneLowSurrogates = false;
  }

  if (!dataIsEmpty(bmp)) {
    // The data set contains BMP code points that are not high surrogates
    // needed for astral code points in the set.
    result.push(createBMPCharacterClasses(bmp));
  }
  if (surrogateMappings.length) {
    // The data set contains astral code points; append character classes
    // based on their surrogate pairs.
    result.push(createSurrogateCharacterClasses(surrogateMappings));
  }
  // https://gist.github.com/mathiasbynens/bbe7f870208abcfec860
  if (hasLoneHighSurrogates) {
    result.push(
      createBMPCharacterClasses(loneHighSurrogates) +
        // Make sure the high surrogates aren’t part of a surrogate pair.
        "(?![\\uDC00-\\uDFFF])"
    );
  }
  if (hasLoneLowSurrogates) {
    result.push(
      // It is not possible to accurately assert the low surrogates aren’t
      // part of a surrogate pair, since JavaScript regular expressions do
      // not support lookbehind.
      "(?:[^\\uD800-\\uDBFF]|^)" + createBMPCharacterClasses(loneLowSurrogates)
    );
  }
  return result.join("|");
}

export interface RegenerateStringOptions {
  bmpOnly?: boolean;
  hasUnicodeFlag?: boolean;
}

export class Regenerate {
  public readonly version: string = "2.0.0";

  public data: number[];

  constructor(...args: Array<string | number>) {
    this.data = [];
    if(args.length > 0) {
      this.add(args);
    }
  }

  /** Adds arguments to the set */

  public add(value: Regenerate | string | number | Array<string | number>,...args: Array<string | number>) {    
    if (value instanceof Regenerate) {
      // Allow passing other Regenerate instances.
      this.data = dataAddData(this.data, value.data);      
      return this;
    }
    
    if (Array.isArray(value)) {
      const that = this;
      if (args.length > 0) {
        value = value.concat(args);
      }
      value.forEach(function(item) {
        that.add(isNumber(item) ? item : symbolToCodePoint(item)
          );
      });      
      return this;
    }
    this.data = dataAdd(
      this.data,
      isNumber(value) ? value : symbolToCodePoint(value)
    );
    return this;
  }

  /** Adds a range of code points from `start` to `end` (inclusive) to the set. */
  public addRange(start: number | string, end: number | string) {
    this.data = dataAddRange(
      this.data,
      isNumber(start) ? start : symbolToCodePoint(start),
      isNumber(end) ? end : symbolToCodePoint(end)
    );
    return this;
  }

  /** Removes arguments from the set */
  public remove(value?: Regenerate | string | number | Array<string | number> ,...args: Array<string | number>) {
    if (!value) {
      return this;
    }
    if (value instanceof Regenerate) {
      // Allow passing other Regenerate instances.
      this.data = dataRemoveData(this.data, value.data);
      return this;
    }
    if (arguments.length > 1) {
      value = slice.call(arguments);
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        this.remove(item);
      });
      return this;
    }
    this.data = dataRemove(
      this.data,
      (typeof value === "number") ? value : symbolToCodePoint(value)
    );
    return this;
  }

  /** Removes a range of code points from `start` to `end` (inclusive) from the set. */
  public removeRange(start: number | string, end: number | string) {
    var startCodePoint = isNumber(start) ? start : symbolToCodePoint(start);
    var endCodePoint = isNumber(end) ? end : symbolToCodePoint(end);
    this.data = dataRemoveRange(this.data, startCodePoint, endCodePoint);
    return this;
  }

  /** Removes any code points from the set that are not present in both the set and the given values */
  public intersection(values: number[] | Regenerate) {
    // Allow passing other Regenerate instances.
    // TODO: Optimize this by writing and using `dataIntersectionData()`.
    var array =
      values instanceof Regenerate ? dataToArray(values.data) : values;
    this.data = dataIntersection(this.data, array);    
    return this;
  }

  /** Returns `true` if the given value is part of the set, and `false` otherwise. */
  public contains(value: number | string): boolean {
    let ret = false;
    const codePoint = (typeof value === 'number') ? value : symbolToCodePoint(value);
    ret = dataContains(this.data,codePoint);
    return ret;
  }

  /** Returns a clone of the current code point set. Any actions performed on the clone won’t mutate the original set. */
  public clone() {
    const set = new Regenerate();
    set.data = this.data.map(v => v);
    return set;
  }

  public toArray() {
    return this.valueOf();
  }

  public toString(options: any) {
    let result = createCharacterClassesFromData(
      this.data,
      options ? options.bmpOnly : false,
      options ? options.hasUnicodeFlag : false
    );
    if (!result) {
      // For an empty set, return something that can be inserted `/here/` to
      // form a valid regular expression. Avoid `(?:)` since that matches the
      // empty string.
      return "[]";
    }
    // Use `\0` instead of `\x00` where possible.
    return result.replace(regexNull, "\\0$1");
  }

  public toRegExp(flags: string) {
    let pattern = this.toString(
      flags && flags.indexOf("u") != -1 ? { hasUnicodeFlag: true } : null
    );
    return RegExp(pattern, flags || "");
  }

  public valueOf() {
    // Note: `valueOf` is aliased as `toArray`.
    return dataToArray(this.data);
  }
}

const regenerate = (set?: Regenerate| string | number | (string | number)[], ...args: (string | number)[]) => {
  let ret = new Regenerate();
  if (set !== undefined) {
    ret = ret.add(set);
  }
  if (args !== undefined) {
    ret = ret.add(args);
  }

  return ret;
};

export default regenerate;