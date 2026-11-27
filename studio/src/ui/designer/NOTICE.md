# Designer references

The designer uses original Cuby TypeScript and geometry. The reference projects informed the following editing patterns.

- [Three.js Sims-like House Builder](https://github.com/ch-bas/threejs-sims-house-builder), Bassem Chagra, MIT. One undo entry per completed gesture and a shared stair-flight footprint for the drawing, slab cut and walkable flight.
- [Architect3D](https://github.com/amitukind/architect3d), Amit Verma, MIT. Represent each partition once so rooms on either side share a wall and its openings. Cuby retains the existing rectangular room model.
- [Blueprint3D Modern](https://github.com/charmlinn/blueprint3d-modern) and [Blueprint3D](https://github.com/furnishup/blueprint3d), Blueprint3D Modern contributors and FurnishUp Inc., MIT. Snapped wall endpoints with a rubber-band preview, plus axis and dimension feedback while drawing.
- [OpenPlan3D](https://github.com/laanlabs/openPlan3D), theLodgeStudio, MIT. Versioned interchange geometry and per-storey wall and opening references.
- [Floorplan 3D](https://github.com/wy51ai/floorplan-3d), wuyi, MIT. SVG drawing layers for rooms, wall edges, opening symbols and measurements alongside the live scene.
