export default function Button({ children, onClick, type = "button", ...props }) {
  return (
    <button type={type} onClick={onClick} {...props}>
      {children}
    </button>
  );
}
