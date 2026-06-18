export const formatPhoneNumber = (number) => {
  // Remove todos os caracteres que não são números
  let cleanPhone = number.replace(/\D/g, '');

  if (cleanPhone.length === 10 || cleanPhone.length === 11) {
    cleanPhone = "55" + cleanPhone;
  }

  return cleanPhone;
}