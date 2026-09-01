# WSC WML 0.3 Repository

This is the official repository for WML (Website Markup Language) 0.3. 
Future Versions are being currently developed.

## Example
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE wml PUBLIC "-//WML//DTD WML Alpha 0.5//EN" "wml-rules.dtd">

<!--
  home.wml
  Compiles to: index.html
  Demo page using WML Alpha 0.5's lowercase tags and restored elements.
-->

<wml version="0.5">

  <head>
    <title>My Notes</title>
    <meta charset="UTF-8" content="text/html; charset=UTF-8"/>

    <!-- imp: shortened from import -->
    <imp src="components/nav.wml" as="nav"/>

    <theme>
      <!-- tok: shortened from token -->
      <tok name="color-brand"  value="#3a3a8c"/>
      <tok name="color-accent" value="#e0a458"/>
      <tok name="font-base"    value="Inter, sans-serif"/>
      <tok name="space-md"     value="1.5rem"/>
    </theme>
  </head>

  <body>

    <state name="noteCount" type="number" value="2"/>
    <state name="showArchived" type="boolean" value="false"/>
    <state name="notes" type="list" value="Grocery list,Meeting notes"/>

    <!-- comp: shortened from component -->
    <comp name="note-item">
      <div class="note-item">
        <checkbox name="archived"/>
        <slot name="default">Untitled note</slot>
      </div>
    </comp>

    <use component="nav"/>

    <div class="hero">
      <h1>My Notes</h1>
      <p>A demo page compiled entirely from <code>home.wml</code>.</p>

      <if condition="showArchived">
        <p class="tip">Showing archived notes too.</p>
      </if>
      <else>
        <p class="tip">Archived notes are hidden.</p>
      </else>
    </div>

    <line weight="thin"/>

    <div class="counter-block">
      <p>You have <span wml-bind="noteCount">0</span> notes</p>
      <button type="button">
        Add note
        <bind event="click" state="noteCount" action="increment"/>
      </button>
      <button type="button">
        Clear count
        <bind event="click" state="noteCount" action="set" value="0"/>
      </button>
    </div>

    <break/>

    <div class="note-list">
      <h2>All notes</h2>
      <!-- rep: shortened from repeat -->
      <rep source="notes" as="note">
        <use component="note-item">
          <span wml-bind="note"></span>
        </use>
      </rep>
    </div>

    <route path="/" src="home.wml"/>
    <route path="/archive" src="archive.wml"/>

  </body>

</wml>
```