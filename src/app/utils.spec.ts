import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, looksLikeHtml } from './utils';

describe('utils', () => {
  describe('htmlToMarkdown', () => {
    it('should convert standard tags to markdown', () => {
      const html = '<h4>Heading</h4><p>Paragraph with <strong>bold</strong> and <a href="http://example.com">link</a>.</p>';
      const expected = '#### Heading\n\nParagraph with **bold** and [link](http://example.com).';
      expect(htmlToMarkdown(html)).toBe(expected);
    });

    it('should handle user example', () => {
      const html = `<h4><strong>FOOTWORK: BALANCE &amp; POWER</strong></h4><p>In this workshop, we will look at how to move from our center and to maintain and carry our alignment and connection through space.</p><p>Through 14 dynamic exercises, we will experience how lines, circles, spirals, and rotations interrelate to generate movement balance in three dimensions. By observing the macrocosmic orbit energy flow of the body, we will refine our ability to move with continuity and precision.</p><p>This mindful practice strengthens the integration of body and mind, allowing the body’s natural power to manifest with clarity and ease.</p><p>This 12-hour workshop experience is open to everyone! All styles of qigong, movement arts, and martial arts are welcome, including beginners. No previous experience of Zhong Xin Dao I Liq Chuan is required.</p><p><strong>Join us in Jesi!</strong></p><p><strong>When<br></strong>20-21 November 2027 – 9:00-17:00 each day (12:00-14:00 lunch)</p><p><strong>Where<br></strong>Scuola Primaria Regina Elena<br>via Puglie, 6<br>00187 Roma RM, Italia<br>(all days)</p><p><strong>Cost to Attend<br></strong>135€ members / 150€ non-members</p><p><strong>Registration<br></strong>Contact: Vinc Po<br>Telephone: +39 123 456 7890<br>Email: <a href="mailto:vinc.po@example.com"><u>vinc.po@example.com</u></a></p>`;

      const expected = `#### **FOOTWORK: BALANCE & POWER**

In this workshop, we will look at how to move from our center and to maintain and carry our alignment and connection through space.

Through 14 dynamic exercises, we will experience how lines, circles, spirals, and rotations interrelate to generate movement balance in three dimensions. By observing the macrocosmic orbit energy flow of the body, we will refine our ability to move with continuity and precision.

This mindful practice strengthens the integration of body and mind, allowing the body's natural power to manifest with clarity and ease.

This 12-hour workshop experience is open to everyone! All styles of qigong, movement arts, and martial arts are welcome, including beginners. No previous experience of Zhong Xin Dao I Liq Chuan is required.

**Join us in Jesi!**

**When** 20-21 November 2027 - 9:00-17:00 each day (12:00-14:00 lunch)

**Where** Scuola Primaria Regina Elena
via Puglie, 6
00187 Roma RM, Italia
(all days)

**Cost to Attend** 135€ members / 150€ non-members

**Registration** Contact: Vinc Po
Telephone: +39 123 456 7890
Email: [vinc.po@example.com](mailto:vinc.po@example.com)`;

      expect(htmlToMarkdown(html)).toBe(expected);
    });

    it('should handle user example with em and i tags', () => {
      const html = `<h4><strong>21 Form Part 1: Movements 8-15</strong></h4><p>The training of the 21 Form will allow you to see how to relax and flow, how to align your body, and to move in a smooth and continuous fashion. Known as the “Fullness Form”, the 21 Form provides you the opportunity to recognize the Six Directions and the Three Dimensions. Through the training you will begin to transition fluidly from one movement to the next, to move and flow with roundness in the Three Dimensions. In the 21 Form you train to recognize the Relaxation Process, emphasizing the qualities of Loose and Soft. You will see how not to use physical strength; how movement has the balance and cycle of Yin and Yang, while remaining soft, circular, and continuous.</p><p>In this workshop we will look at movements 8-15 and applications for each movement, highlighting the principles in action throughout the process.</p><p>This 12-hour workshop experience is open to everyone! All styles of qigong, movement arts, and martial arts are welcome, including beginners. No previous experience of Zhong Xin Dao I Liq Chuan is required.</p><p><strong>Join us in Jesi!</strong></p><p><strong>When<br></strong>11-12 September 2026 – 9:00-17:00 each day (12:00-14:00 lunch)</p><p><strong>Where<br></strong>Wing Chun kung fu – Asd ASAM “La Via Dell’Acqua”<br>Viale don Minzoni 24<br>60035 Jesi, Marche, Italy<br><em><i>(all days)</i></em></p><p><strong>Cost to Attend<br></strong>135€ members / 150€ non-members</p><p><strong>Registration<br></strong>Contact: Gian Gia<br>Telephone: +39 123 456 7891<br>Email: <a href="mailto:info@example.com"><u>info@example.com</u></a></p>`;

      const expected = `#### **21 Form Part 1: Movements 8-15**

The training of the 21 Form will allow you to see how to relax and flow, how to align your body, and to move in a smooth and continuous fashion. Known as the “Fullness Form”, the 21 Form provides you the opportunity to recognize the Six Directions and the Three Dimensions. Through the training you will begin to transition fluidly from one movement to the next, to move and flow with roundness in the Three Dimensions. In the 21 Form you train to recognize the Relaxation Process, emphasizing the qualities of Loose and Soft. You will see how not to use physical strength; how movement has the balance and cycle of Yin and Yang, while remaining soft, circular, and continuous.

In this workshop we will look at movements 8-15 and applications for each movement, highlighting the principles in action throughout the process.

This 12-hour workshop experience is open to everyone! All styles of qigong, movement arts, and martial arts are welcome, including beginners. No previous experience of Zhong Xin Dao I Liq Chuan is required.

**Join us in Jesi!**

**When** 11-12 September 2026 - 9:00-17:00 each day (12:00-14:00 lunch)

**Where** Wing Chun kung fu - Asd ASAM “La Via Dell'Acqua”
Viale don Minzoni 24
60035 Jesi, Marche, Italy
**(all days)**

**Cost to Attend** 135€ members / 150€ non-members

**Registration** Contact: Gian Gia
Telephone: +39 123 456 7891
Email: [info@example.com](mailto:info@example.com)`;

      expect(htmlToMarkdown(html)).toBe(expected);
    });

    it('should handle complex user example with links and formatting', () => {
      const html = `<p>This workshop will be on the topic of <b>Structure, Relaxation, and Energy</b>. No previous experience with this art is necessary to attend this workshop; the approach will add depth to existing practice, as well as provide practical exercises to train body and mind.</p><p></p><p>The workshop will be led by <b>Master Hsin C</b>, the son of Grand Master Sam C. Hsin is an incredible martial artist and a profoundly kind, generous, and gifted teacher. He has an exceptional capacity to feed movement, helping fill gaps in your structure, alignment, connection and attention, and his ability to control the opponent through point of contact is extraordinary.</p><p><b></b></p><p><b>Contact:</b> Lucas D (the local organizer, email Lucas to register or get more details).</p><p><u><a href="mailto:lucas.d@example.com" target="_blank">lucas.d@example.com</a></u></p><p>+33 123 456 789</p><p></p><p><b><i><u><a href="https://www.google.com/url?q=https://docs.google.com/forms/d/e/1FAIpQLSdoNBNxJqsjRAXBzGKWSqccXZwDiy05EDP0kU10i24P4etkhw/viewform?usp%3Dheader&amp;sa=D&amp;source=calendar&amp;usd=2&amp;usg=AOvVaw3KtpW0_zpiHepCprzr3MBN" target="_blank">Please register</a></u></i></b><b> before 4rd of April to attend the workshop and pay the early-bird price.</b></p><p>(payment details on the registration form)</p><p></p><p><b><u>Workshop details</u></b></p><p><b><u></u></b></p><p><b>Date:</b> Weekend 11-12 April 2026: <b>Time: </b>10:00-18:00<br>(There will be a 1h30 lunch break, you can bring your own lunch or eat  nearby)</p><p><b>Price</b>: 200 members; 220 non members (the early bird price; +20 EUR after 4rd of April)</p><p><b>Location:</b> <u><a href="https://www.google.com/url?q=https://maps.app.goo.gl/n7tPUzCkLXAqU5bC9&amp;sa=D&amp;source=calendar&amp;usd=2&amp;usg=AOvVaw2qtupsf7Vg-zY_XOeCK_DX" target="_blank">42 Rue des Sept Arpents, 93500 Pantin</a></u> </p><p></p><p><b>Language &amp; Translation:</b> The workshop will be in English, but there will be a good number of fluent French speakers who can translate for anyone who wishes.<br><br>More details at the mini-site: <a href="https://www.google.com/url?q=https://docs.google.com/document/d/e/2PACX-1vQZkQgL0JFHZE5AVSkPHm2KHryPpQsrXXNGLrbgpQVFRQRGjG5TgPJzrr1JKV1hcuXYfd5zD4cCfKKf/pub&amp;sa=D&amp;source=calendar&amp;usd=2&amp;usg=AOvVaw3FpFK_fEmP2oZyHkF8cpfH" target="_blank"><b><u>Master Hsin C's workshop on Structure, Relaxation, and Energy</u></b></a></p>`;

      const expected = `This workshop will be on the topic of **Structure, Relaxation, and Energy**. No previous experience with this art is necessary to attend this workshop; the approach will add depth to existing practice, as well as provide practical exercises to train body and mind.

The workshop will be led by **Master Hsin C**, the son of Grand Master Sam C. Hsin is an incredible martial artist and a profoundly kind, generous, and gifted teacher. He has an exceptional capacity to feed movement, helping fill gaps in your structure, alignment, connection and attention, and his ability to control the opponent through point of contact is extraordinary.

**Contact:** Lucas D (the local organizer, email Lucas to register or get more details).

[lucas.d@example.com](mailto:lucas.d@example.com)

+33 123 456 789

**[Please register](https://www.google.com/url?q=https://docs.google.com/forms/d/e/1FAIpQLSdoNBNxJqsjRAXBzGKWSqccXZwDiy05EDP0kU10i24P4etkhw/viewform?usp%3Dheader&sa=D&source=calendar&usd=2&usg=AOvVaw3KtpW0_zpiHepCprzr3MBN) before 4rd of April to attend the workshop and pay the early-bird price.**

(payment details on the registration form)

**Workshop details**

**Date:** Weekend 11-12 April 2026: **Time: **10:00-18:00
(There will be a 1h30 lunch break, you can bring your own lunch or eat  nearby)

**Price**: 200 members; 220 non members (the early bird price; +20 EUR after 4rd of April)

**Location:** [42 Rue des Sept Arpents, 93500 Pantin](https://www.google.com/url?q=https://maps.app.goo.gl/n7tPUzCkLXAqU5bC9&sa=D&source=calendar&usd=2&usg=AOvVaw2qtupsf7Vg-zY_XOeCK_DX) 

**Language & Translation:** The workshop will be in English, but there will be a good number of fluent French speakers who can translate for anyone who wishes.

More details at the mini-site: [**Master Hsin C's workshop on Structure, Relaxation, and Energy**](https://www.google.com/url?q=https://docs.google.com/document/d/e/2PACX-1vQZkQgL0JFHZE5AVSkPHm2KHryPpQsrXXNGLrbgpQVFRQRGjG5TgPJzrr1JKV1hcuXYfd5zD4cCfKKf/pub&sa=D&source=calendar&usd=2&usg=AOvVaw3FpFK_fEmP2oZyHkF8cpfH)`;

      expect(htmlToMarkdown(html)).toBe(expected);
    });

    it('should return empty string for empty input', () => {
      expect(htmlToMarkdown('')).toBe('');
    });
  });

  describe('looksLikeHtml', () => {
    it('should return true for strings with html tags', () => {
      expect(looksLikeHtml('<p>hello</p>')).toBe(true);
      expect(looksLikeHtml('<h4>Title</h4>')).toBe(true);
      expect(looksLikeHtml('Text with <br> break')).toBe(true);
    });

    it('should return false for strings without html tags', () => {
      expect(looksLikeHtml('Hello world')).toBe(false);
      expect(looksLikeHtml('**Bold** markdown')).toBe(false);
      expect(looksLikeHtml('Pure text')).toBe(false);
    });
  });
});
