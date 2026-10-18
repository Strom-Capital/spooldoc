# Changelog

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
