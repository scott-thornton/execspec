/**
 * Strict JSON parser for the TS host runtime: rejects duplicate object
 * keys, malformed numbers, invalid escapes, lone surrogate escapes, raw
 * control characters, and trailing garbage - the same guarantees the
 * Swift runtime's parser provides. Input is a string whose UTF-8 was
 * already validated by the transport (fatal TextDecoder).
 */

export type WireValue =
  | null
  | boolean
  | string
  | number
  | WireValue[]
  | { [key: string]: WireValue };

export class StrictJSONError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StrictJSONError";
  }
}

export function strictParseJSON(text: string): WireValue {
  const parser = new Parser(Array.from(text));
  parser.skipWhitespace();
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (!parser.isAtEnd) {
    throw new StrictJSONError("trailing characters after JSON value");
  }
  return value;
}

class Parser {
  private readonly chars: readonly string[];
  private index = 0;

  public constructor(chars: readonly string[]) {
    this.chars = chars;
  }

  public get isAtEnd(): boolean {
    return this.index >= this.chars.length;
  }

  private peek(): string | undefined {
    return this.chars[this.index];
  }

  private peekCode(): number | undefined {
    return this.chars[this.index]?.codePointAt(0);
  }

  public skipWhitespace(): void {
    for (;;) {
      const code = this.peekCode();
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
        this.index += 1;
        continue;
      }
      return;
    }
  }

  public parseValue(): WireValue {
    const code = this.peekCode();
    if (code === undefined) {
      throw new StrictJSONError("unexpected end of input");
    }
    switch (code) {
      case 0x7b: return this.parseObject();
      case 0x5b: return this.parseArray();
      case 0x22: return this.parseString();
      case 0x74: this.expectLiteral("true"); return true;
      case 0x66: this.expectLiteral("false"); return false;
      case 0x6e: this.expectLiteral("null"); return null;
      default:
        if (code === 0x2d || (code >= 0x30 && code <= 0x39)) {
          return this.parseNumber();
        }
        throw new StrictJSONError("unexpected character");
    }
  }

  private expectLiteral(literal: string): void {
    for (const char of literal) {
      if (this.peek() !== char) {
        throw new StrictJSONError("invalid literal");
      }
      this.index += 1;
    }
  }

  private parseObject(): WireValue {
    this.index += 1;
    const object: { [key: string]: WireValue } = {};
    this.skipWhitespace();
    if (this.peekCode() === 0x7d) {
      this.index += 1;
      return object;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peekCode() !== 0x22) {
        throw new StrictJSONError("expected object key");
      }
      const key = this.parseString();
      this.skipWhitespace();
      if (this.peekCode() !== 0x3a) {
        throw new StrictJSONError("expected ':' in object");
      }
      this.index += 1;
      this.skipWhitespace();
      const value = this.parseValue();
      if (key in object) {
        throw new StrictJSONError(`duplicate key '${key}'`);
      }
      object[key] = value;
      this.skipWhitespace();
      if (this.peekCode() === 0x2c) {
        this.index += 1;
        continue;
      }
      if (this.peekCode() === 0x7d) {
        this.index += 1;
        return object;
      }
      throw new StrictJSONError("expected ',' or '}' in object");
    }
  }

  private parseArray(): WireValue {
    this.index += 1;
    const values: WireValue[] = [];
    this.skipWhitespace();
    if (this.peekCode() === 0x5d) {
      this.index += 1;
      return values;
    }
    for (;;) {
      this.skipWhitespace();
      values.push(this.parseValue());
      this.skipWhitespace();
      if (this.peekCode() === 0x2c) {
        this.index += 1;
        continue;
      }
      if (this.peekCode() === 0x5d) {
        this.index += 1;
        return values;
      }
      throw new StrictJSONError("expected ',' or ']' in array");
    }
  }

  private parseString(): string {
    this.index += 1;
    let text = "";
    for (;;) {
      const char = this.peek();
      if (char === undefined) {
        throw new StrictJSONError("unterminated string");
      }
      const code = char.codePointAt(0) ?? 0;
      if (code === 0x22) {
        this.index += 1;
        return text;
      }
      if (code === 0x5c) {
        this.index += 1;
        text += this.parseEscape();
        continue;
      }
      if (code < 0x20) {
        throw new StrictJSONError("raw control character in string");
      }
      text += char;
      this.index += 1;
    }
  }

  private parseEscape(): string {
    const code = this.peekCode();
    if (code === undefined) {
      throw new StrictJSONError("unterminated escape");
    }
    this.index += 1;
    switch (code) {
      case 0x22: return "\"";
      case 0x5c: return "\\";
      case 0x2f: return "/";
      case 0x62: return "\b";
      case 0x66: return "\f";
      case 0x6e: return "\n";
      case 0x72: return "\r";
      case 0x74: return "\t";
      case 0x75: {
        let scalar = this.parseHex4();
        if (scalar >= 0xd800 && scalar <= 0xdbff) {
          if (this.peekCode() !== 0x5c) {
            throw new StrictJSONError("unpaired surrogate escape");
          }
          this.index += 1;
          if (this.peekCode() !== 0x75) {
            throw new StrictJSONError("unpaired surrogate escape");
          }
          this.index += 1;
          const low = this.parseHex4();
          if (low < 0xdc00 || low > 0xdfff) {
            throw new StrictJSONError("invalid surrogate pair");
          }
          scalar = 0x10000 + ((scalar - 0xd800) << 10) + (low - 0xdc00);
        } else if (scalar >= 0xdc00 && scalar <= 0xdfff) {
          throw new StrictJSONError("unpaired low surrogate escape");
        }
        return String.fromCodePoint(scalar);
      }
      default:
        throw new StrictJSONError("invalid escape");
    }
  }

  private parseHex4(): number {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const code = this.peekCode();
      if (code === undefined) {
        throw new StrictJSONError("truncated \\u escape");
      }
      let digit: number;
      if (code >= 0x30 && code <= 0x39) {
        digit = code - 0x30;
      } else if (code >= 0x61 && code <= 0x66) {
        digit = code - 0x61 + 10;
      } else if (code >= 0x41 && code <= 0x46) {
        digit = code - 0x41 + 10;
      } else {
        throw new StrictJSONError("invalid \\u escape");
      }
      value = (value << 4) | digit;
      this.index += 1;
    }
    return value;
  }

  private parseNumber(): number {
    const start = this.index;
    if (this.peekCode() === 0x2d) {
      this.index += 1;
    }
    const first = this.peekCode();
    if (first === undefined || first < 0x30 || first > 0x39) {
      throw new StrictJSONError("invalid number");
    }
    if (first === 0x30) {
      this.index += 1;
    } else {
      this.consumeDigits();
    }
    if (this.peekCode() === 0x2e) {
      this.index += 1;
      const digit = this.peekCode();
      if (digit === undefined || digit < 0x30 || digit > 0x39) {
        throw new StrictJSONError("invalid number fraction");
      }
      this.consumeDigits();
    }
    const exponent = this.peekCode();
    if (exponent === 0x65 || exponent === 0x45) {
      this.index += 1;
      const sign = this.peekCode();
      if (sign === 0x2b || sign === 0x2d) {
        this.index += 1;
      }
      const digit = this.peekCode();
      if (digit === undefined || digit < 0x30 || digit > 0x39) {
        throw new StrictJSONError("invalid number exponent");
      }
      this.consumeDigits();
    }
    const spelling = this.chars.slice(start, this.index).join("");
    const parsed = Number(spelling);
    if (!Number.isFinite(parsed)) {
      throw new StrictJSONError("number out of range");
    }
    return parsed;
  }

  private consumeDigits(): void {
    for (;;) {
      const code = this.peekCode();
      if (code === undefined || code < 0x30 || code > 0x39) {
        return;
      }
      this.index += 1;
    }
  }
}
