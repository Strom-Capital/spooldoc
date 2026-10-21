# Changelog

## [0.4.0](https://github.com/Strom-Capital/spooldoc/compare/v0.3.1...v0.4.0) (2026-10-21)


### Features

* **web:** email destination (closes [#16](https://github.com/Strom-Capital/spooldoc/issues/16)) ([#126](https://github.com/Strom-Capital/spooldoc/issues/126)) ([1a69164](https://github.com/Strom-Capital/spooldoc/commit/1a691646fcbace74f72524c6342c1e9372432b6e))
* **web:** Microsoft 365 sender for email ([#128](https://github.com/Strom-Capital/spooldoc/issues/128)) ([cb26dbc](https://github.com/Strom-Capital/spooldoc/commit/cb26dbcc82467946f48cac9101b2068e795dd8f8))
* **web:** number, date and currency formats in Settings ([#126](https://github.com/Strom-Capital/spooldoc/issues/126)) ([1a69164](https://github.com/Strom-Capital/spooldoc/commit/1a691646fcbace74f72524c6342c1e9372432b6e))
* **web:** webhook destination (closes [#17](https://github.com/Strom-Capital/spooldoc/issues/17)) ([#130](https://github.com/Strom-Capital/spooldoc/issues/130)) ([516356f](https://github.com/Strom-Capital/spooldoc/commit/516356f29cd0fad4ec935962734ccc0520fa41c6))

## [0.3.1](https://github.com/Strom-Capital/spooldoc/compare/v0.3.0...v0.3.1) (2026-10-21)


### Bug Fixes

* **ibmi:** queue text with ä, ö and å reads right ([e0bf248](https://github.com/Strom-Capital/spooldoc/commit/e0bf2483151e240eb48779f650e37cbbd58aeaf4))

## [0.3.0](https://github.com/Strom-Capital/spooldoc/compare/v0.2.0...v0.3.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* Template tags are renamed: d.doc is d.pg, d.documents is d.pgs and d.sample.splf is d.splf, and d.sample.id is gone. In XML definitions, xml.document: is xml.pageGroup:. The upgrade rewrites the templates, definitions and file name patterns saved in Spooldoc. Rename them in any copies you keep elsewhere.
* Spooldoc renders every document with a Carbone server. When you upgrade, add the carbone service from compose.yaml. Then copy the public key from Settings, under Rendering, into CARBONE_AUTHENTICATION_PUBLIC_KEY in .env, run docker compose up -d carbone and click Check again. Until Carbone works, new spooled files wait. Templates and file name patterns written for 0.2.0 use Nunjucks tags such as {{ doc.invoiceNo }}. Rewrite them as Carbone tags such as {d.pg.invoiceNo}; the Template tab and the definition check show what to change. See docs/carbone.md and docs/deployment.md.

### Features

* Excel templates make XLSX and PDF ([#80](https://github.com/Strom-Capital/spooldoc/issues/80)) ([3f80d57](https://github.com/Strom-Capital/spooldoc/commit/3f80d573a2567b21a412a218f8f156c5065aeea2))
* IFS destination ([#97](https://github.com/Strom-Capital/spooldoc/issues/97)) ([8e2c17a](https://github.com/Strom-Capital/spooldoc/commit/8e2c17af9bcabf6ae016e4dab1622e884dc50bba))
* page groups and templates, in the app and in the data ([#60](https://github.com/Strom-Capital/spooldoc/issues/60)) ([d4b429f](https://github.com/Strom-Capital/spooldoc/commit/d4b429ffed489432f7f70c00589b9da14b072b93))
* render every format with Carbone (closes [#46](https://github.com/Strom-Capital/spooldoc/issues/46)) ([#50](https://github.com/Strom-Capital/spooldoc/issues/50)) ([3ac675a](https://github.com/Strom-Capital/spooldoc/commit/3ac675a2e40fd9daf1ca65e3fc5149480d71bfe4))
* shorter template tags, d.pg and d.pgs ([#77](https://github.com/Strom-Capital/spooldoc/issues/77)) ([21f1a9b](https://github.com/Strom-Capital/spooldoc/commit/21f1a9be2253124d16e2ff621d344c6ec77bd1ae))
* the agent designs and edits Excel templates (closes [#81](https://github.com/Strom-Capital/spooldoc/issues/81)) ([#84](https://github.com/Strom-Capital/spooldoc/issues/84)) ([b5d00a6](https://github.com/Strom-Capital/spooldoc/commit/b5d00a69ce04f03a5eeecae2ccec70d841427c75))
* the agent designs and edits Word templates (closes [#55](https://github.com/Strom-Capital/spooldoc/issues/55)) ([#56](https://github.com/Strom-Capital/spooldoc/issues/56)) ([79f0f76](https://github.com/Strom-Capital/spooldoc/commit/79f0f766cb09b6bb12dd58ed3e715b8ef491416a))
* **web:** a job has a list of outputs ([#48](https://github.com/Strom-Capital/spooldoc/issues/48)) ([5e0f014](https://github.com/Strom-Capital/spooldoc/commit/5e0f014ece3f9e9737f8920c2413535be2cbd988))
* **web:** agent asks which kind of template to make ([#75](https://github.com/Strom-Capital/spooldoc/issues/75)) ([812d116](https://github.com/Strom-Capital/spooldoc/commit/812d116cd66412b1689877c09c46a9d99dc23a4d))
* **web:** agent token usage in Settings and the agent panel ([#93](https://github.com/Strom-Capital/spooldoc/issues/93)) ([d1c7a94](https://github.com/Strom-Capital/spooldoc/commit/d1c7a94d91ad4944a6aaca2ba221fd2d81f46d9c))
* **web:** Back and Next between job builder steps ([#73](https://github.com/Strom-Capital/spooldoc/issues/73)) ([64f27c4](https://github.com/Strom-Capital/spooldoc/commit/64f27c4903503d65b145430e361d299554613a4a))
* **web:** breadcrumbs on nested pages ([#68](https://github.com/Strom-Capital/spooldoc/issues/68)) ([5212d4c](https://github.com/Strom-Capital/spooldoc/commit/5212d4cecb856bb0e7020a1239c94d2ba07ec0cb))
* **web:** count the ready and held files of each output queue ([#65](https://github.com/Strom-Capital/spooldoc/issues/65)) ([fbca7fe](https://github.com/Strom-Capital/spooldoc/commit/fbca7fe0d0196a570a5939ddf32f0f1cd7ca10ff))
* **web:** group the sidebar, a Profile page, and a phone menu ([#88](https://github.com/Strom-Capital/spooldoc/issues/88)) ([21158c0](https://github.com/Strom-Capital/spooldoc/commit/21158c00ed849ef69290ece0fc9ad2d6dee9b329))
* **web:** held files and shared-queue notice for on-demand jobs ([#63](https://github.com/Strom-Capital/spooldoc/issues/63)) ([ec8888b](https://github.com/Strom-Capital/spooldoc/commit/ec8888bffa3c35e2a4174fa74bf1064ec3438379))
* **web:** hints on buttons that need explaining ([#99](https://github.com/Strom-Capital/spooldoc/issues/99)) ([487a707](https://github.com/Strom-Capital/spooldoc/commit/487a7074960bc1bc4b180bd2ace881113d8de23e))
* **web:** masking is a setting, off on a new install ([#57](https://github.com/Strom-Capital/spooldoc/issues/57)) ([37f1732](https://github.com/Strom-Capital/spooldoc/commit/37f17326ba2667dd36399dddd26c522acb4c08ea))
* **web:** next and run now turn primary when ready ([#96](https://github.com/Strom-Capital/spooldoc/issues/96)) ([8ed3a3a](https://github.com/Strom-Capital/spooldoc/commit/8ed3a3a286e344f6ccda584e9f78e124c26b7eed))
* **web:** one agent suggestion per format ([#95](https://github.com/Strom-Capital/spooldoc/issues/95)) ([9df8235](https://github.com/Strom-Capital/spooldoc/commit/9df823555da8eb18ff5c5af43426c97a8615102f))
* **web:** one path bar for the spooled file, page group, page and template ([#62](https://github.com/Strom-Capital/spooldoc/issues/62)) ([1a6a5d8](https://github.com/Strom-Capital/spooldoc/commit/1a6a5d8bb53accfdc0c23900a3ea22559279c06c))
* **web:** one pattern for table row actions ([#91](https://github.com/Strom-Capital/spooldoc/issues/91)) ([3af9ce2](https://github.com/Strom-Capital/spooldoc/commit/3af9ce25fbb2ed73df023302ec493d9ff05c32b3))
* **web:** status pills and a status filter on the queue page ([#67](https://github.com/Strom-Capital/spooldoc/issues/67)) ([d02d709](https://github.com/Strom-Capital/spooldoc/commit/d02d70961f2c9a8fb3fe68eb9e329f77af12c239))
* **web:** Support group in the sidebar with the docs, discussions and issues ([#102](https://github.com/Strom-Capital/spooldoc/issues/102)) ([ea4a1d8](https://github.com/Strom-Capital/spooldoc/commit/ea4a1d8aa772a556536e69c9073190d5a552eef5))
* **web:** the docs in the app at /docs ([#100](https://github.com/Strom-Capital/spooldoc/issues/100)) ([6548127](https://github.com/Strom-Capital/spooldoc/commit/6548127cc0d5093e40b919463620714b79838c4e))
* **web:** the Queues page shows the jobs of each queue ([#87](https://github.com/Strom-Capital/spooldoc/issues/87)) ([2d9b7b4](https://github.com/Strom-Capital/spooldoc/commit/2d9b7b42be0fb091bc160ddcf96488c449981a0d))
* **web:** the Servers page shows the jobs of each server ([#92](https://github.com/Strom-Capital/spooldoc/issues/92)) ([c516f2d](https://github.com/Strom-Capital/spooldoc/commit/c516f2d8c8e86e232141b0c9206ecd60591d73fd))
* Word templates (closes [#18](https://github.com/Strom-Capital/spooldoc/issues/18)) ([#53](https://github.com/Strom-Capital/spooldoc/issues/53)) ([9a5898d](https://github.com/Strom-Capital/spooldoc/commit/9a5898dd1e8bb6bac39f60641f7b28089aff8651))


### Bug Fixes

* IFS writes never lose or silently replace a file ([#108](https://github.com/Strom-Capital/spooldoc/issues/108)) ([406e5f6](https://github.com/Strom-Capital/spooldoc/commit/406e5f6411e0cb41848140e7e749295c7df06cb7))
* reconnect after a dropped IBM i connection, and show connection status ([#64](https://github.com/Strom-Capital/spooldoc/issues/64)) ([409ad5f](https://github.com/Strom-Capital/spooldoc/commit/409ad5fd652377707cfc4761e8dad36082aa614a))
* **web:** a template that turns into another kind makes that kind's default files ([#98](https://github.com/Strom-Capital/spooldoc/issues/98)) ([8fe10ae](https://github.com/Strom-Capital/spooldoc/commit/8fe10aeb1cdde8ab9f38d261cd58a960fcedd06b))
* **web:** agent reads the Carbone tips for Word templates ([#76](https://github.com/Strom-Capital/spooldoc/issues/76)) ([671b1e6](https://github.com/Strom-Capital/spooldoc/commit/671b1e64f23cfecaf8f54a585d638428827ef17e))
* **web:** call the AI assistant the agent ([#70](https://github.com/Strom-Capital/spooldoc/issues/70)) ([6f2f8b6](https://github.com/Strom-Capital/spooldoc/commit/6f2f8b621a634775e1ce3342ccd22497123955c4))
* **web:** clearer agent panel copy, no masking badge or model id ([#71](https://github.com/Strom-Capital/spooldoc/issues/71)) ([d0693f5](https://github.com/Strom-Capital/spooldoc/commit/d0693f50b8210f4d825645853d0aa2a1f7fc9772))
* **web:** code no longer shows through the editor's line numbers ([#79](https://github.com/Strom-Capital/spooldoc/issues/79)) ([b841892](https://github.com/Strom-Capital/spooldoc/commit/b84189238c71c72c6f91491c6ad6551cbb0df45a))
* **web:** drop the status next to the server picker on Queues ([#66](https://github.com/Strom-Capital/spooldoc/issues/66)) ([6df57e6](https://github.com/Strom-Capital/spooldoc/commit/6df57e656a16cce842e6c05c1baf3828d97e8333))
* **web:** field hits show the template tag on hover ([#78](https://github.com/Strom-Capital/spooldoc/issues/78)) ([693251f](https://github.com/Strom-Capital/spooldoc/commit/693251f0f93e75cdaa60218e228d48585926e3eb))
* **web:** jobs saved by 0.2.0 read after the upgrade ([#107](https://github.com/Strom-Capital/spooldoc/issues/107)) ([c341a34](https://github.com/Strom-Capital/spooldoc/commit/c341a34fe7e2eea56d3a548a34135bf7087eb4bb))
* **web:** new spooled files wait while Carbone does not work ([#51](https://github.com/Strom-Capital/spooldoc/issues/51)) ([4def410](https://github.com/Strom-Capital/spooldoc/commit/4def410829bd65db753caac437821449f7cd88cd))
* **web:** one-row job builder top bar with Rename in the menu ([#69](https://github.com/Strom-Capital/spooldoc/issues/69)) ([3b86c4b](https://github.com/Strom-Capital/spooldoc/commit/3b86c4b1e516e00d12d8fac1cfd0bf8e1c9db15c))
* **web:** regexes that backtrack exponentially in visibleText and the SVG sniffer ([#104](https://github.com/Strom-Capital/spooldoc/issues/104)) ([5503c40](https://github.com/Strom-Capital/spooldoc/commit/5503c402cfbaf0f0498cc95888174c5f30fbd34f))
* **web:** say which files each template kind makes when switching ([#74](https://github.com/Strom-Capital/spooldoc/issues/74)) ([0339b0d](https://github.com/Strom-Capital/spooldoc/commit/0339b0df001e3957fb3ae72a6a3a6538866d6ae6))
* **web:** the agent drops the thinking with the tool results it trims ([#58](https://github.com/Strom-Capital/spooldoc/issues/58)) ([39bdc87](https://github.com/Strom-Capital/spooldoc/commit/39bdc87947cf575164db473386663c2cbf7b8aeb))
* **web:** the Job log is as wide as the other pages ([#89](https://github.com/Strom-Capital/spooldoc/issues/89)) ([e4d00dd](https://github.com/Strom-Capital/spooldoc/commit/e4d00dde722db59a91a1993164962684f9cadf77))
* **web:** version and draft state as pills in the job builder ([#72](https://github.com/Strom-Capital/spooldoc/issues/72)) ([0236d6d](https://github.com/Strom-Capital/spooldoc/commit/0236d6dac6913549dc916469c891323211ff41f9))

## [0.2.0](https://github.com/Strom-Capital/spooldoc/compare/v0.1.0...v0.2.0) (2026-10-19)


### Features

* IBM i errors say what to do, with the system's text under Details ([#39](https://github.com/Strom-Capital/spooldoc/issues/39)) ([e9bb795](https://github.com/Strom-Capital/spooldoc/commit/e9bb795e6003266e4f6ff82f4cdd1db46e17ae06))
* **web:** confirm before a job starts deleting spooled files ([#38](https://github.com/Strom-Capital/spooldoc/issues/38)) ([067501f](https://github.com/Strom-Capital/spooldoc/commit/067501f27054a3f6253d4a47e3162b9ee6688e8e))
* **web:** consistency and accessibility pass ([#41](https://github.com/Strom-Capital/spooldoc/issues/41)) ([cdbc13b](https://github.com/Strom-Capital/spooldoc/commit/cdbc13b7aedcec637ae44b4291295fae830b49fc))
* **web:** show only what works: no "Coming later", a true sign-up message ([#40](https://github.com/Strom-Capital/spooldoc/issues/40)) ([38dd3c3](https://github.com/Strom-Capital/spooldoc/commit/38dd3c3589f8dc0c38ace2bfa309729f1887304f))


### Bug Fixes

* **web:** refuse to adopt a data queue while queues still send to the current one ([#25](https://github.com/Strom-Capital/spooldoc/issues/25)) ([fb97dec](https://github.com/Strom-Capital/spooldoc/commit/fb97dec879c8ef3c64fcb3fe2dac75113b53e71d))
* **web:** show watcher and run failures, and say when a list is cut off ([#36](https://github.com/Strom-Capital/spooldoc/issues/36)) ([d0078d3](https://github.com/Strom-Capital/spooldoc/commit/d0078d35b957c7ed41ba8d48f7910c58966e0be1))

## 0.1.0 (2026-10-18)


### Features

* backlog option, job and form type filters, clearer Trigger step ([912e4ae](https://github.com/Strom-Capital/spooldoc/commit/912e4ae5429f97f73f951befb7219743a8418480))
* **core:** spool parser, definitions, extraction, templates and workspace ([67abf78](https://github.com/Strom-Capital/spooldoc/commit/67abf781f1b518a91af929d1bef3a9bed670d1a9))
* **demo-spool:** demo documents and queues for PUB400 ([dcfb153](https://github.com/Strom-Capital/spooldoc/commit/dcfb153f80c3592f9f0dee9ea5fa9ab29f1546ce))
* **ibmi:** jt400 connection, queue and spooled file lists, sample capture ([1f982b9](https://github.com/Strom-Capital/spooldoc/commit/1f982b92643218d38f7639b1e0512e4ba779ea09))
* PDF output, container image, CI and trust docs ([ab84691](https://github.com/Strom-Capital/spooldoc/commit/ab846911a9744d100d69a86926ae1ce585d918fa))
* skip files the definition is not for ([7034187](https://github.com/Strom-Capital/spooldoc/commit/7034187d2f088976b8b92d71946c5c9f41d6452b))
* **web:** AI chat that proposes definitions and templates ([418b7fb](https://github.com/Strom-Capital/spooldoc/commit/418b7fb34880d8826a19a1a514b245df05d3499d))
* **web:** arrows between the pipeline steps ([24e2cf4](https://github.com/Strom-Capital/spooldoc/commit/24e2cf4a89eaca3c039605e40b6b6e7583f6f9b0))
* **web:** asset library for logos, images and fonts in templates ([065e1ed](https://github.com/Strom-Capital/spooldoc/commit/065e1edb08f50f6077207bb917dc90a589eaa364))
* **web:** choose the AI provider, key, model and effort in Settings ([11cddaf](https://github.com/Strom-Capital/spooldoc/commit/11cddafc16c20b55ba6e5310d2fcc3a32e4b4872))
* **web:** design-time app with connect, queues, capture and workbench ([561ebcd](https://github.com/Strom-Capital/spooldoc/commit/561ebcda71c7d4052670bdf0eaf6f355777c3f69))
* **web:** dismiss Needs attention items, and toasts for saves and actions ([5b772ef](https://github.com/Strom-Capital/spooldoc/commit/5b772efd1e1bae799fa42d1074a3db85aacf2dd6))
* **web:** held files, switch to polling and shared queues on the Trigger step ([8e733d1](https://github.com/Strom-Capital/spooldoc/commit/8e733d1d70f1225a504a72dd76e1779a3e2e43a4))
* **web:** Home page with setup steps, counts and runs over time ([a3c5672](https://github.com/Strom-Capital/spooldoc/commit/a3c56727ae8b8993061c470344b541043b487889))
* **web:** HTML output next to PDF; level pipeline connectors and logo ([487f1dc](https://github.com/Strom-Capital/spooldoc/commit/487f1dcdd67410f965c9a5d8161c55d71b59e1e6))
* **web:** icon-rail sidebar and a workbench that fits laptop screens ([141dd20](https://github.com/Strom-Capital/spooldoc/commit/141dd20c76b0dec17e062f4993dd8258e2b425fe))
* **web:** keep the AI assistant's conversation with the job ([65d83e8](https://github.com/Strom-Capital/spooldoc/commit/65d83e85c1f8caf3521d29574fdc4b805b34aaed))
* **web:** queue pages load, refresh and empty states ([31d6160](https://github.com/Strom-Capital/spooldoc/commit/31d6160441eea3f987e4e6c7b0b601efaa53fa91))
* **web:** rename the built-in destination to Spooldoc download ([9769d88](https://github.com/Strom-Capital/spooldoc/commit/9769d88f46e4a01a0e518688c820ed35086f9bb4))
* **web:** retention for job runs ([1c32710](https://github.com/Strom-Capital/spooldoc/commit/1c3271012a3e266fad82de6311e464d127e522fb))
* **web:** servers, queues, jobs, destinations and job log ([da41d79](https://github.com/Strom-Capital/spooldoc/commit/da41d79df76ba63ae4ed42e0caae53ec3f9899de))
* **web:** show when the AI assistant is working ([132ca2d](https://github.com/Strom-Capital/spooldoc/commit/132ca2d0bade0eb54499f74fbe5d3687e45bc0e1))
* **web:** start a job from another job's definition or template ([69ccf9f](https://github.com/Strom-Capital/spooldoc/commit/69ccf9f69422f6e07fbee9f9a784e98e20eca27d))
* **web:** syntax-highlighted editors for definition, template and JSON ([293bc89](https://github.com/Strom-Capital/spooldoc/commit/293bc894e5eb101cc328d0648ed20fcce70dbb0e))
* **web:** view a spooled file's pages from the queue's file list ([5ba4eb1](https://github.com/Strom-Capital/spooldoc/commit/5ba4eb148dac3c439ebf11db3d81d4163dc6dfd2))


### Bug Fixes

* findings from the first full code review ([4ea9a84](https://github.com/Strom-Capital/spooldoc/commit/4ea9a84595f57f52ce955c1b7c215328fa97cd2c))
* **ibmi:** bounded sign-on instead of an endless "Connecting..." ([ae99c69](https://github.com/Strom-Capital/spooldoc/commit/ae99c699ec2e4bead67ae1f781d5459148dfd4c2))
* **ibmi:** readable messages for an unreachable host ([62b8842](https://github.com/Strom-Capital/spooldoc/commit/62b884205db2dbb3970959570737703399d2cd63))
* **web:** back link and queue list width on a queue's spooled files ([01b1c83](https://github.com/Strom-Capital/spooldoc/commit/01b1c83c4480e57923377c94f77d66c1220793af))
* **web:** full page load after sign-on and disconnect ([52eccae](https://github.com/Strom-Capital/spooldoc/commit/52eccae3ba97100d3a4f7eb1c30eb2b513e33ad2))
* **web:** Home counts output queues, not data queues ([2263834](https://github.com/Strom-Capital/spooldoc/commit/2263834737548340de100fde19c505c25c519100))
* **web:** land on home after sign-up and sign-in ([2de0daa](https://github.com/Strom-Capital/spooldoc/commit/2de0daa5c8bf1c1aacda287698466bd0834f3266))
* **web:** name documents in the selector by the definition's output name ([4e1bec6](https://github.com/Strom-Capital/spooldoc/commit/4e1bec69ebec716e0737a80707124ea6ff52b233))
* **web:** pipeline strip renders every step on every load ([4fa61ba](https://github.com/Strom-Capital/spooldoc/commit/4fa61bad1bc2cf02a9d421880b385562c4b01c49))
