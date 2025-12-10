import React from "react";

const Button = ({ label = "Click me", onClick }) => (
  <button
    style={{ padding: '10px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
    onClick={onClick}
  >
    {label}
  </button>
);

export default Button;
