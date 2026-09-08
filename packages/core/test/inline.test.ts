import { describe, expect, it } from 'vitest';
import {
  isMeaningfulAlt,
  numberToWords,
  spokenEmail,
  spokenHostname,
  spokenLink,
} from '../src/index.js';
import { speakInlineUrls } from '../src/speakable/inline.js';

describe('inline speakable helpers', () => {
  it('speaks hostnames without www, path, query or hash', () => {
    expect(spokenHostname('https://www.Example.com/a/b?x=1#y')).toBe('example dot com');
    expect(spokenHostname('docs.example.net')).toBe('docs dot example dot net');
    expect(spokenLink('https://sub.example.org/x')).toBe('Link to sub dot example dot org');
    expect(spokenLink('mailto:a@b.com')).toBe('a at b dot com');
  });

  it('speaks emails', () => {
    expect(spokenEmail('jane.doe@example.com')).toBe('jane dot doe at example dot com');
  });

  it('judges alt text', () => {
    expect(isMeaningfulAlt('A chart of revenue')).toBe(true);
    expect(isMeaningfulAlt('')).toBe(false);
    expect(isMeaningfulAlt('   ')).toBe(false);
    expect(isMeaningfulAlt('image')).toBe(false);
    expect(isMeaningfulAlt('Screenshot')).toBe(false);
    expect(isMeaningfulAlt('IMG_2031.jpg')).toBe(false);
    expect(isMeaningfulAlt('assets/hero.png')).toBe(false);
    expect(isMeaningfulAlt('My Photo (1).jpg')).toBe(false);
    expect(isMeaningfulAlt('Screen Shot 2026-09-07 at 10.12.03 PM.png')).toBe(false);
  });

  it('rewrites URLs before emails so an address inside a query string stays part of the URL', () => {
    expect(speakInlineUrls('Read https://example.com/p?to=a@b.com now')).toBe(
      'Read Link to example dot com now',
    );
    expect(speakInlineUrls('Mail a@b.com or see www.x.org.')).toBe(
      'Mail a at b dot com or see Link to x dot org.',
    );
    expect(speakInlineUrls('Ask www.bob@example.com or bob@www.example.com.')).toBe(
      'Ask www dot bob at example dot com or bob at www dot example dot com.',
    );
  });

  it('converts numbers to words up to 999 and falls back to digits', () => {
    expect(numberToWords(1)).toBe('one');
    expect(numberToWords(20)).toBe('twenty');
    expect(numberToWords(42)).toBe('forty-two');
    expect(numberToWords(100)).toBe('one hundred');
    expect(numberToWords(315)).toBe('three hundred fifteen');
    expect(numberToWords(1000)).toBe('1000');
  });
});
