/**
 * @vitest-environment jsdom
 *
 * The efetch parse. Every case here is a shape measured against live
 * PubMed on 2026-08-30, not a shape imagined for the test.
 */
import { describe, expect, it } from "vitest";
import { parsePubmedAbstract } from "./pubmed";

const article = (inner: string) =>
  `<?xml version="1.0" ?><PubmedArticleSet><PubmedArticle>${inner}</PubmedArticle></PubmedArticleSet>`;

const UNSTRUCTURED = article(`
  <MedlineCitation>
    <PMID Version="1">29024657</PMID>
    <Article>
      <Journal>
        <JournalIssue><PubDate><Year>2017</Year></PubDate></JournalIssue>
        <Title>Methods in molecular biology</Title>
        <ISOAbbreviation>Methods Mol Biol</ISOAbbreviation>
      </Journal>
      <ArticleTitle>Detecting Activated Cell Populations Using Single-Cell RNA-Seq.</ArticleTitle>
      <Abstract><AbstractText>Neurons  respond
      to stimulation.</AbstractText></Abstract>
    </Article>
    <MeshHeadingList>
      <MeshHeading>
        <DescriptorName UI="D000679" MajorTopicYN="N">Amygdala</DescriptorName>
      </MeshHeading>
      <MeshHeading>
        <DescriptorName UI="D008810" MajorTopicYN="Y">Mice, Inbred C57BL</DescriptorName>
        <QualifierName UI="Q000235" MajorTopicYN="N">genetics</QualifierName>
      </MeshHeading>
    </MeshHeadingList>
  </MedlineCitation>`);

describe("parsePubmedAbstract", () => {
  it("reads title, journal, year and an unstructured abstract", () => {
    const r = parsePubmedAbstract(UNSTRUCTURED, "29024657");
    expect(r.pmid).toBe("29024657");
    expect(r.title).toBe(
      "Detecting Activated Cell Populations Using Single-Cell RNA-Seq.",
    );
    // ISOAbbreviation wins over the full title — it is what fits a chip.
    expect(r.journal).toBe("Methods Mol Biol");
    expect(r.year).toBe("2017");
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].label).toBeNull();
    // Whitespace inside the XML is layout, not content.
    expect(r.sections[0].text).toBe("Neurons respond to stimulation.");
  });

  it("keeps a structured abstract's own run-in labels, in order", () => {
    const xml = article(`
      <MedlineCitation><PMID Version="1">33301246</PMID><Article>
        <ArticleTitle>T</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND">b</AbstractText>
          <AbstractText Label="METHODS">m</AbstractText>
          <AbstractText Label="RESULTS">r</AbstractText>
          <AbstractText Label="CONCLUSIONS">c</AbstractText>
        </Abstract>
      </Article></MedlineCitation>`);
    const r = parsePubmedAbstract(xml, "33301246");
    expect(r.sections.map((s) => s.label)).toEqual([
      "BACKGROUND",
      "METHODS",
      "RESULTS",
      "CONCLUSIONS",
    ]);
  });

  it("marks a major MeSH heading, and one major only through a qualifier", () => {
    const r = parsePubmedAbstract(UNSTRUCTURED, "29024657");
    expect(r.mesh.map((m) => m.descriptor)).toEqual([
      "Amygdala",
      "Mice, Inbred C57BL",
    ]);
    expect(r.mesh[0].major).toBe(false);
    expect(r.mesh[1].major).toBe(true);
    expect(r.mesh[1].ui).toBe("D008810");
    expect(r.mesh[1].qualifiers).toEqual(["genetics"]);

    const viaQualifier = article(`
      <MedlineCitation><PMID Version="1">1</PMID><Article><ArticleTitle>T</ArticleTitle></Article>
      <MeshHeadingList><MeshHeading>
        <DescriptorName UI="D1" MajorTopicYN="N">Lymphoma</DescriptorName>
        <QualifierName UI="Q000145" MajorTopicYN="Y">classification</QualifierName>
      </MeshHeading></MeshHeadingList></MedlineCitation>`);
    // PubMed stars this heading too ("Lymphoma/classification*"), so a
    // check on the descriptor alone would call it minor.
    expect(parsePubmedAbstract(viaQualifier, "1").mesh[0].major).toBe(true);
  });

  it("🛑 takes THIS paper's PMID, not the first one in the document", () => {
    // A real record embeds its references' PMIDs. Reading the document
    // for `PMID` returns one of those, and it belongs to another paper.
    const withRefs = article(`
      <MedlineCitation>
        <CommentsCorrectionsList>
          <CommentsCorrections><PMID Version="1">99999999</PMID></CommentsCorrections>
        </CommentsCorrectionsList>
        <PMID Version="1">32015507</PMID>
        <Article><ArticleTitle>T</ArticleTitle></Article>
      </MedlineCitation>
      <PubmedData><ReferenceList>
        <Reference><ArticleIdList><ArticleId IdType="pubmed">31997390</ArticleId></ArticleIdList></Reference>
      </ReferenceList></PubmedData>`);
    expect(parsePubmedAbstract(withRefs, "32015507").pmid).toBe("32015507");
  });

  it("an abstract-less record is empty, not an error", () => {
    const xml = article(
      `<MedlineCitation><PMID Version="1">7</PMID><Article><ArticleTitle>T</ArticleTitle></Article></MedlineCitation>`,
    );
    const r = parsePubmedAbstract(xml, "7");
    expect(r.sections).toEqual([]);
    expect(r.mesh).toEqual([]);
    expect(r.title).toBe("T");
  });

  it("throws on efetch's 200-with-<ERROR> body for an unknown id", () => {
    // 🛑 efetch does NOT 404 an id it cannot resolve; it answers 200.
    // Without this branch the card would render blank and look like a
    // paper with no abstract.
    expect(() =>
      parsePubmedAbstract(
        `<?xml version="1.0" ?><eFetchResult><ERROR>Empty id list</ERROR></eFetchResult>`,
        "0",
      ),
    ).toThrow(/Empty id list/);
  });
});
