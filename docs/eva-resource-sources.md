# NASA EVA resource references / NASA EVA 资源参考

These official NASA references justify the model boundary. They are reference
ranges, not Mars suit requirements, and no number is hard-coded into the route
planner as a flight value.

- [NASA-STD-3001 Spacesuits technical brief](https://www.nasa.gov/wp-content/uploads/2025/09/ochmo-tb-050-spacesuits.pdf): suited metabolic-rate ranges and the need to connect workload to life-support design.
- [NASA EVA mishap technical brief](https://www.nasa.gov/wp-content/uploads/2023/07/suit_water_intrusion_mishap_investigation_report.pdf): heritage EMU duration and contingency examples; not a Mars mission requirement.
- [NASA Spacesuits Volume 2](https://www.nasa.gov/reference/11-0-spacesuits-vol-2/): life support, nutrition, thermal control, and crew-resource requirements for surface EVAs.
- [NASA EVA planning and energy expenditure](https://ntrs.nasa.gov/citations/20240009328): metabolic rate and training data considerations for EVA planning.

The current implementation uses only mission-configured EVA duration, return
reserve, payload, and science-stop duration. A future resource model must declare
units and source data for oxygen, CO₂ scrubbing, cooling water, battery, and
metabolic-rate assumptions before those quantities affect route feasibility.
