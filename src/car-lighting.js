export function applyCarLighting(materials, headlights, opacity = 1) {
  const markers = headlights?.markerActivation ?? 0;
  materials.lampMaterial.emissiveIntensity = markers * 1.2;
  materials.popupLampMaterial.emissiveIntensity = (headlights?.activation ?? 0) * 3;
  materials.underglowMaterial.opacity = markers * 0.85 * opacity;
  materials.underglowMesh.visible = markers > 0.005;
}
