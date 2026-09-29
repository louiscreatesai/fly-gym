# Third-party components

| What | Where in this repo | Source | Licence |
|---|---|---|---|
| NeuroMechFly v2 body meshes and kinematic tree, and the recorded walking step cycle | `assets/fly/`, `js/scenes/preworkout/stepcycle.js` | flygym 1.2.1, NeLy lab, EPFL (https://github.com/NeLy-EPFL/flygym) | Apache License 2.0, `licenses/flygym-Apache-2.0.txt` |
| Brain geometry (points and wires sampled from neuron skeletons) and replayed spikes | `assets/brain/` | Derived from the Janelia MaleCNS v1.0 connectome (Berg et al. 2026). The spikes come from our own runs of a leaky integrate-and-fire model following Shiu et al. 2024. | CC BY 4.0 (attribution: Janelia MaleCNS v1.0, Berg et al. 2026) |
| three.js r186 (only the files the app imports) | `vendor/three/` | https://threejs.org | MIT, `licenses/three.js-MIT.txt` |
| Inter font | `assets/fonts/` | The Inter Project Authors (https://github.com/rsms/inter) | SIL Open Font License 1.1, `licenses/Inter-OFL-1.1.txt` |

Changes to the flygym material: the STL meshes and the MJCF body tree were converted into one binary file (`fly.bin`) plus a JSON rig (`fly.json`). Left-side parts were mirrored as the MJCF specifies, and the per-vertex normals were recomputed.

Please cite:
- Wang-Chen S. et al. (2024), NeuroMechFly v2: simulating embodied sensorimotor control in adult Drosophila, Nature Methods.
- Lobato-Rios V. et al. (2022), NeuroMechFly, a neuromechanical model of adult Drosophila melanogaster, Nature Methods.
- Shiu P. K. et al. (2024), A Drosophila computational brain model reveals sensorimotor processing, Nature 634, 210-219.
- Berg S. et al. (2026), the Janelia male CNS connectome (MaleCNS v1.0).
