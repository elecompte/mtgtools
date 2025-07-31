from flask import Flask, render_template, request, redirect, url_for

app = Flask(__name__)



@app.route('/')
def index():
    return render_template('index.html')

@app.route('/scuteswarm', methods=['GET', 'POST'])
def scuteswarm():
    final_swarms = 0
    initial = 0
    lands = 0
    doubler = 1
    if request.method == 'POST':
        try:
            initial = int(request.form['initial'])
            lands = int(request.form['lands'])
            doubler = int(request.form.get('doubler', 0))
            i = 0
            while i < lands:
                final_swarms += initial + (initial * (doubler))
                i += 1
            initial

        except Exception:
            final_swarms = None
    return render_template('scuteswarm.html', final_swarms=final_swarms, initial=final_swarms, lands=lands, doubler=doubler)

if __name__ == "__main__":
    app.run(debug=True)
    app.run(host='0.0.0.0')
