# Model licensing

The protifer **source code** is licensed under Apache-2.0 (see `/LICENSE`).
The **model weights** served from this directory are **not** covered by that
license — each model carries the license of its upstream source. They are
repackaged here to ONNX for serving via Triton; ONNX conversion is a derivative
in the original work's preferred-for-serving form and does not change the
upstream license.

protifer hosts all of the models below with permission from the respective
rightsholders. Where the upstream license is copyleft (GPL-3.0 / AGPL-3.0), it
is listed here for attribution and transparency; the copyleft obligations
(including AGPL-3.0 §13 network source provisioning) are satisfied through that
separate hosting grant and do **not** transfer to operators or users of this
service.

| Model (served name)                         | Upstream                                          | License        | Basis for inclusion |
| ------------------------------------------- | ------------------------------------------------- | -------------- | ------------------- |
| `prot_t5_pipeline` (ProtT5 encoder)         | [Rostlab/prot-t5-xl-uniref50-enc-onnx][prott5]    | MIT            | License             |
| `prott5_sec` (secondary structure)          | ProtT5-based predictor (Rostlab)                  | MIT            | License             |
| `prott5_cons` (conservation)                | [Rostlab/VESPA][vespa]                            | **AGPL-3.0**   | Hosting permission  |
| `vespag` (variant effect)                   | [JSchlensok/VespaG][vespag]                        | **GPL-3.0**    | Hosting permission  |
| `tmbed` (transmembrane topology)            | [Rostlab/TMbed][tmbed]                             | No public license | Hosting permission |
| `seth` (intrinsic disorder)                 | [Rostlab/SETH][seth]                              | No public license | Hosting permission |
| `bind_embed` (binding residues, bindEmbed21)| [Rostlab/bindPredict][bindpredict]                | MIT            | License             |
| `light_attention_subcell` (subcellular loc) | [HannesStark/protein-localization][la]            | MIT            | License             |
| `light_attention_membrane` (membrane loc)   | [HannesStark/protein-localization][la]            | MIT            | License             |

`_`-prefixed entries in this directory (`_internal_prott5_*`, `_bind_embed_cv*`,
`_tmbed_cv*`, `_tmbed_viterbi`, `_deferred`) are internal sub-models / ensemble
folds of the public models above and inherit the same license.

[prott5]: https://huggingface.co/Rostlab/prot-t5-xl-uniref50-enc-onnx
[vespa]: https://github.com/Rostlab/VESPA
[vespag]: https://github.com/JSchlensok/VespaG
[tmbed]: https://github.com/Rostlab/TMbed
[seth]: https://github.com/DagmarIlz/SETH
[bindpredict]: https://github.com/Rostlab/bindPredict
[la]: https://github.com/HannesStark/protein-localization
