const MetricCard = ({ title, value, description }) => {
  return (
    <div className="metric-card">
      <h4>{title}</h4>
      <p className="metric-card__value">{value ?? "—"}</p>
      {description ? (
        <span className="metric-card__hint">{description}</span>
      ) : null}
    </div>
  );
};

export default MetricCard;
