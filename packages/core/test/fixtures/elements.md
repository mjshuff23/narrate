# Narrate Fixture Document

Intro paragraph with **bold**, *italic*, ~~struck~~ and `inline code` text.
This line is hard-wrapped
across three
lines.

## Links and Images

A [descriptive link](https://example.com/some/deep/path?utm=1) in prose.
A bare link https://www.example.org/path/to/thing?q=1 in prose.
An autolink <https://docs.example.net/guide> here.
Write to jane.doe@example.com for details.

![A chart of quarterly revenue by region](chart.png)

![](decorative.png)

![screenshot](shot.png)

Inline ![diagram of the pipeline](pipe.png) image mid-sentence.

### Lists

- First bullet
- Second bullet with [reference link][ref]
  - Nested bullet

1. Step one
2. Step two
3. Step three

- [x] Done task
- [ ] Open task

#### Deep Heading Four

Text under a level-four heading, spoken but not a chapter.

## Quotes and Code

> A quoted paragraph.
>
> Second quoted paragraph.

```ts
const x = 1;
console.log(x);
```

    indented code block

## Tables

| Name | Role | Team |
| --- | --- | --- |
| Ada | Engineer | Core |
| Grace | Admiral | Navy |

| c1 | c2 | c3 | c4 | c5 | c6 | c7 |
| -- | -- | -- | -- | -- | -- | -- |
| 1 | 2 | 3 | 4 | 5 | 6 | 7 |

---

## Footnotes and HTML

A claim with a footnote[^1] and another[^note].

<div align="center">
<p>Block HTML paragraph inside Markdown.</p>
</div>

Line with inline <b>bold html</b> and a<br>break.

## Last Section

Closing paragraph.

[^1]: The first footnote body.
[^note]: The second footnote body, with *emphasis*.

[ref]: https://example.com/reference
