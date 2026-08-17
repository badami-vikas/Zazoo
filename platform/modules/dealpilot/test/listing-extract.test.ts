import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractFromCards,
  extractFromJsonLd,
  extractListings,
  readJsonLdNodes,
} from "../src/listing-extract.js";

const PAGE = "https://saintlouisgroup.com/listings/";

test("a schema.org Product with an Offer becomes a listing payload", () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"St. Louis CPA Practice",
     "category":"Accounting","url":"/listings/stl-cpa","offers":{"@type":"Offer","price":"850000","priceCurrency":"USD"}}
  </script></head><body></body></html>`;
  const { rows, strategy } = extractListings(html, PAGE);
  assert.equal(strategy, "json_ld");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    name: "St. Louis CPA Practice",
    industry: "Accounting",
    askPrice: 850_000,
    url: "https://saintlouisgroup.com/listings/stl-cpa",
  });
});

test("listings nested in an ItemList are flattened out", () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ItemList","itemListElement":[
      {"@type":"ListItem","position":1,"item":{"@type":"Product","name":"Firm A","offers":{"price":500000}}},
      {"@type":"ListItem","position":2,"item":{"@type":"Product","name":"Firm B","offers":{"price":1200000}}}
    ]}</script>`;
  const rows = extractFromJsonLd(html, PAGE);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.name), ["Firm A", "Firm B"]);
  assert.equal(rows[1]?.askPrice, 1_200_000);
});

test("a Yoast @graph wrapper is unwrapped", () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","name":"Listings"},
      {"@type":"Product","name":"Tax Practice","offers":{"price":"$1.2M"}}
    ]}</script>`;
  const rows = extractFromJsonLd(html, PAGE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, "Tax Practice");
  assert.equal(rows[0]?.askPrice, 1_200_000);
});

test("an address becomes a City, ST geo", () => {
  const html = `<script type="application/ld+json">
    {"@type":"LocalBusiness","name":"Metro Firm","offers":{"price":400000},
     "address":{"addressLocality":"St. Louis","addressRegion":"MO"}}</script>`;
  assert.equal(extractFromJsonLd(html, PAGE)[0]?.geo, "St. Louis, MO");
});

test("structural JSON-LD nodes are not mistaken for listings", () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"BreadcrumbList","itemListElement":[]},
      {"@type":"Organization","name":"Saint Louis Group","url":"https://saintlouisgroup.com"},
      {"@type":"WebSite","name":"SLG"}
    ]}</script>`;
  // Organization carries a name but no price and is not a listing type — nothing should match.
  assert.deepEqual(extractFromJsonLd(html, PAGE), []);
});

test("malformed JSON-LD is skipped without taking the page down", () => {
  const html = `<script type="application/ld+json">{ this is not json </script>
    <script type="application/ld+json">{"@type":"Product","name":"Good One","offers":{"price":100000}}</script>`;
  const rows = extractFromJsonLd(html, PAGE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.name, "Good One");
});

test("readJsonLdNodes returns nothing for a page with no JSON-LD", () => {
  assert.deepEqual(readJsonLdNodes("<html><body><p>no structured data</p></body></html>"), []);
});

test("listing cards are read when the page publishes no JSON-LD", () => {
  const html = `<html><body>
    <article class="listing">
      <h3><a href="/listings/dental-group">Multi-Site Dental Group</a></h3>
      <p>Industry: Healthcare</p>
      <p>Location: Kansas City, MO</p>
      <p>Asking Price: $2,400,000</p>
      <p>Gross Revenue: $3,100,000</p>
      <p>Cash Flow: $780,000</p>
    </article>
  </body></html>`;
  const { rows, strategy } = extractListings(html, PAGE);
  assert.equal(strategy, "cards");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    name: "Multi-Site Dental Group",
    industry: "Healthcare",
    geo: "Kansas City, MO",
    askPrice: 2_400_000,
    revenue: 3_100_000,
    sde: 780_000,
    url: "https://saintlouisgroup.com/listings/dental-group",
  });
});

test("several cards on one page each become a row", () => {
  const html = `<body>
    <li class="listing"><h4>Firm One</h4><p>Asking Price: $500,000</p><a href="/a"></a></li>
    <li class="listing"><h4>Firm Two</h4><p>Asking Price: $750,000</p><a href="/b"></a></li>
  </body>`;
  const rows = extractFromCards(html, PAGE);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.askPrice), [500_000, 750_000]);
});

test("a card with money but no name is discarded rather than guessed at", () => {
  const html = `<article class="listing"><p>Asking Price: $500,000</p></article>`;
  assert.deepEqual(extractFromCards(html, PAGE), []);
});

test("a card with a name but no money is discarded", () => {
  const html = `<article class="listing"><h3>Some Heading</h3><p>Call for details</p></article>`;
  assert.deepEqual(extractFromCards(html, PAGE), []);
});

test("navigation chrome does not become listings", () => {
  const html = `<body><ul class="nav">
      <li><a href="/about">About</a></li>
      <li><a href="/contact">Contact Us</a></li>
    </ul></body>`;
  assert.deepEqual(extractListings(html, PAGE).rows, []);
});

test("a page yielding nothing reports strategy none rather than inventing a row", () => {
  const result = extractListings("<html><body><h1>No listings at this time</h1></body></html>", PAGE);
  assert.deepEqual(result.rows, []);
  assert.equal(result.strategy, "none");
});

test("k and m money suffixes are honored in card text", () => {
  const html = `<article class="listing"><h3>Suffix Firm</h3><p>Asking Price: $1.4M</p><p>Cash Flow: $350k</p></article>`;
  const row = extractFromCards(html, PAGE)[0]!;
  assert.equal(row.askPrice, 1_400_000);
  assert.equal(row.sde, 350_000);
});

test("relative listing links are resolved against the page URL", () => {
  const html = `<article class="listing"><h3><a href="detail/9">Relative Firm</a></h3><p>Price: $100,000</p></article>`;
  assert.equal(extractFromCards(html, "https://quietlight.com/listings/")[0]?.url, "https://quietlight.com/listings/detail/9");
});

test("the same listing appearing twice on a page is emitted once", () => {
  const card = `<article class="listing"><h3><a href="/l/1">Dup Firm</a></h3><p>Asking Price: $200,000</p></article>`;
  assert.equal(extractFromCards(card + card, PAGE).length, 1);
});

test("script and style bodies never leak into extracted text", () => {
  const html = `<article class="listing">
      <script>var price = "Asking Price: $999,999";</script>
      <h3>Real Firm</h3><p>Asking Price: $300,000</p>
    </article>`;
  assert.equal(extractFromCards(html, PAGE)[0]?.askPrice, 300_000);
});

test("JSON-LD wins over card markup when a page has both", () => {
  const html = `<script type="application/ld+json">{"@type":"Product","name":"Structured","offers":{"price":111000}}</script>
    <article class="listing"><h3>Heuristic</h3><p>Asking Price: $222,000</p></article>`;
  const { rows, strategy } = extractListings(html, PAGE);
  assert.equal(strategy, "json_ld");
  assert.equal(rows[0]?.name, "Structured");
});
