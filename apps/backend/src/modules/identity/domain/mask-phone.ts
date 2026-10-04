/**
 * One masking rule for the whole app; the SMS adapters in core/phone use the
 * same one, so a number never reaches a log in full from either side.
 */
export { maskPhone } from '../../../core/phone/sri-lanka-phone';
