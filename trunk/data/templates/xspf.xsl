<?xml version="1.0" ?>
<xsl:stylesheet
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sb="http://songbirdnest.com/data/1.0#"
  xmlns:ot="http://skrul.com/syrinxtape/1.0#"
  xmlns="http://xspf.org/ns/0/"
  version="1.0"
>
<xsl:output method="xml"/>
<xsl:template match="list">
<playlist version="0" xmlns="http://xspf.org/ns/0/">
  <title>Syrinxtape: song count, runtine</title>
  <creator>Syrinxtape blah</creator>
  <info>http://linktohistape</info>
  <location>http://linktothistape</location>
  <xsl:apply-templates select="items"/>
</playlist>
</xsl:template>

<xsl:template match="items">
  <trackList>
    <xsl:apply-templates/>
  </trackList>
</xsl:template>

<xsl:template match="item">
  <track>
    <location><xsl:value-of select="@href"/></location>
    <meta ref="type">mp3</meta>
    <title>
      <xsl:value-of select="sb:artistName"/>
      <xsl:text> - </xsl:text>
      <xsl:value-of select="sb:trackName"/>
    </title>
    <info>http://loinktothistape</info>
  </track>
</xsl:template>

</xsl:stylesheet>
