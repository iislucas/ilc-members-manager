import { Crepe } from '@milkdown/crepe';

// Custom htmlToMarkdown function inlined
function htmlToMarkdown(html) {
    if (!html) return '';
    
    let md = html;
    
    // Normalize characters and entities first
    md = md.replace(/’/g, "'");
    md = md.replace(/–/g, "-");
    md = md.replace(/\u00a0/g, ' ');
    md = md.replace(/&amp;/gi, '&');
    
    // Handle specific pattern <strong>Title<br></strong> -> **Title** 
    md = md.replace(/<strong>(.*?)<br\s*\/?>\s*<\/strong>/gi, '**$1** ');
    
    // Replace headings
    md = md.replace(/<h4>/gi, '#### ');
    md = md.replace(/<\/h4>/gi, '\n\n');
    
    // Replace paragraphs
    md = md.replace(/<p>/gi, '');
    md = md.replace(/<\/p>/gi, '\n\n');
    
    // Replace strong
    md = md.replace(/<strong>/gi, '**');
    md = md.replace(/<\/strong>/gi, '**');
    
    // Replace br
    md = md.replace(/<br\s*\/?>/gi, '\n');
    
    // Replace links
    md = md.replace(/<a href="(.*?)">(.*?)<\/a>/gi, '[$2]($1)');
    
    // Replace underline (remove)
    md = md.replace(/<u>/gi, '');
    md = md.replace(/<\/u>/gi, '');

    // Replace emphasis/italic
    md = md.replace(/<em>/gi, '*');
    md = md.replace(/<\/em>/gi, '*');
    md = md.replace(/<i>/gi, '*');
    md = md.replace(/<\/i>/gi, '*');
    
    // Clean up multiple newlines
    md = md.replace(/\n{3,}/g, '\n\n');
    
    return md.trim();
}

const testHtml = `<h4><strong>21 Form Part 1: Movements 8-15</strong></h4><p>The training of the 21 Form will allow you to see how to relax and flow, how to align your body, and to move in a smooth and continuous fashion. Known as the “Fullness Form”, the 21 Form provides you the opportunity to recognize the Six Directions and the Three Dimensions. Through the training you will begin to transition fluidly from one movement to the next, to move and flow with roundness in the Three Dimensions. In the 21 Form you train to recognize the Relaxation Process, emphasizing the qualities of Loose and Soft. You will see how not to use physical strength; how movement has the balance and cycle of Yin and Yang, while remaining soft, circular, and continuous.</p><p>In this workshop we will look at movements 8-15 and applications for each movement, highlighting the principles in action throughout the process.</p><p>This 12-hour workshop experience is open to everyone! All styles of qigong, movement arts, and martial arts are welcome, including beginners. No previous experience of Zhong Xin Dao I Liq Chuan is required.</p><p><strong>Join us in Jesi!</strong></p><p><strong>When<br></strong>11-12 September 2026 – 9:00-17:00 each day (12:00-14:00 lunch)</p><p><strong>Where<br></strong>Wing Chun kung fu – Asd ASAM “La Via Dell’Acqua”<br>Viale don Minzoni 24<br>60035 Jesi, Marche, Italy<br><em><i>(all days)</i></em></p><p><strong>Cost to Attend<br></strong>135€ members / 150€ non-members</p><p><strong>Registration<br></strong>Contact: Gian Gia<br>Telephone: +39 123 456 7891<br>Email: <a href="mailto:info@example.com"><u>info@example.com</u></a></p>`;

const initialMarkdown = htmlToMarkdown(testHtml);

const crepe = new Crepe({
    root: '#editor',
    defaultValue: initialMarkdown,
});

crepe.create().then(() => {
    const statusEl = document.getElementById('status');
    const outputEl = document.getElementById('markdown-output');
    
    const finalMarkdown = crepe.getMarkdown();
    outputEl.textContent = finalMarkdown;

    const htmlTagRegex = /<(p|h4|strong|em|i|br|a|u)(\s|>)/i;
    
    if (htmlTagRegex.test(finalMarkdown)) {
        statusEl.textContent = "❌ Test Failed: Leftover HTML tags found in markdown!";
        statusEl.className = "status error";
    } else {
        statusEl.textContent = "✅ Test Passed: HTML converted and loaded successfully with NO leftover tags.";
        statusEl.className = "status success";
    }
}).catch(err => {
    document.getElementById('status').textContent = "Error: " + err.message;
    document.getElementById('status').className = "status error";
});
