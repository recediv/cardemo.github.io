export function applyCarLighting(materials, headlights, braking, forwardSpeed, opacity = 1) {
  const markers = headlights?.markerActivation ?? 0;
  materials.lampMaterial.emissiveIntensity = markers * 1.2;
  materials.popupLampMaterial.emissiveIntensity = (headlights?.activation ?? 0) * 3;
  materials.tailMaterial.emissiveIntensity = braking ? 2.5 : markers * 0.45;
  materials.reverseLampMaterial.emissiveIntensity = forwardSpeed < -0.15 ? 2.4 : 0;
  materials.underglowMaterial.opacity = markers * 0.85 * opacity;
  materials.underglowMesh.visible = markers > 0.005;
}
